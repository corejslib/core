import HttpBody from "#lib/http/body";
import Headers from "#lib/http/headers";
import HttpMessage from "#lib/http/message";
import Range from "#lib/range";
import { MultipartStreamEncoder } from "#lib/stream/multipart";

export default class HttpRange {
    #ranges = [];
    #httpRange;

    // properties
    get size () {
        return this.#ranges.length;
    }

    get hasRanges () {
        return this.#ranges.length !== 0;
    }

    get isValidHttpRange () {
        return this.httpRange != null;
    }

    get httpRange () {
        RANGE: if ( this.#httpRange === undefined ) {
            this.#httpRange = null;

            if ( !this.#ranges.length ) break RANGE;

            const ranges = [];

            for ( const range of this.#ranges ) {
                if ( !range.isValidHttpRange ) {
                    break RANGE;
                }

                ranges.push( range.httpRange );
            }

            this.#httpRange = ranges.join( "," );
        }

        return this.#httpRange;
    }

    // public
    addRange ( range ) {
        range = Range.new( range );

        this.#ranges.push( range );

        this.#clearCache();

        return this;
    }

    async createHttpMessage ( body, { maxRanges, headers = {}, contentLength, createBody = true } = {} ) {
        headers = new Headers( headers );

        var supported = true,
            multiple = true;

        const httpBody = HttpBody.new( body, {
                "contentType": headers.get( "content-type" ),
            } ),
            ranges = [];

        if ( !httpBody.isFunction ) {
            contentLength = httpBody.contentLength;
        }

        RANGES: {
            if ( httpBody.isStream ) {
                multiple = false;
            }

            if ( !this.size || ( maxRanges && this.size > maxRanges ) ) {
                supported = false;

                break RANGES;
            }

            for ( let range of this.#ranges ) {
                range = range.createRange( {
                    contentLength,
                } );

                if ( !range.isValidHttpContentRange ) {
                    supported = false;

                    break RANGES;
                }

                ranges.push( range );
            }

            if ( !multiple && this.size > 1 ) {
                supported = false;

                break RANGES;
            }
        }

        if ( !supported ) {
            return new HttpMessage( {
                "status": 416,
                "headers": {
                    "accept-ranges": "bytes",
                    "content-range": `bytes */${ contentLength ?? "*" }`,
                },
            } );
        }
        else {
            if ( ranges.length === 1 ) {
                const range = ranges[ 0 ];

                if ( createBody ) {
                    if ( httpBody.isFunction ) {
                        body = await httpBody.body( range );
                    }
                    else {
                        body = httpBody.createBody( { range } );
                    }
                }

                return new HttpMessage( {
                    "status": 206,
                    "headers": {
                        "accept-ranges": "bytes",
                        "content-length": range.length,
                        "content-type": httpBody.contentType,
                        "content-range": range.httpContentRange,
                    },
                    "body": createBody
                        ? body
                        : undefined,
                } );
            }
            else {
                if ( createBody ) {
                    const multipartStream = new MultipartStreamEncoder( "byteranges" );

                    for ( const range of ranges ) {
                        multipartStream.write( {
                            "headers": {
                                "content-type": httpBody.contentType,
                                "content-range": range.httpContentRange,
                            },
                            "body": async () => {
                                return httpBody.isFunction
                                    ? httpBody.body( range )
                                    : httpBody.createBody( { range } );
                            },
                        } );
                    }

                    multipartStream.end();

                    return new HttpMessage( {
                        "status": 206,
                        "headers": {
                            "accept-ranges": "bytes",
                            "content-type": multipartStream.type,
                        },
                        "body": multipartStream,
                    } );
                }
                else {
                    return new HttpMessage( {
                        "status": 206,
                        "headers": {
                            "accept-ranges": "bytes",
                            "content-type": `multipart/byteranges; boundary=${ MultipartStreamEncoder.generateBoundary() }`,
                        },
                    } );
                }
            }
        }
    }

    clear () {
        this.#ranges = [];

        this.#clearCache();

        return this;
    }

    [ Symbol.iterator ] () {
        return this.#ranges.values();
    }

    // private
    #clearCache () {
        this.#httpRange = undefined;
    }
}
