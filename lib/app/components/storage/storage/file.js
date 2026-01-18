import path from "node:path";
import Headers from "#lib/http/headers";
import Interval from "#lib/interval";

export default class StorageFile {
    #cache;
    #id;
    #path;
    #name;
    #size;
    #imageId;
    #imagePath;
    #imageOid;
    #encrypted;
    #lastModified;
    #contentType;
    #cacheControl;
    #contentDisposition;
    #contentLength;
    #inactiveMaxAge;
    #expires;
    #etag;
    #headers;
    #location;

    constructor ( cache, data ) {
        this.#cache = cache;
        this.#id = data.id;
        this.#path = data.path;
        this.#size = data.size;
        this.#imageId = data.storage_image_id;
        this.#imagePath = data.image_path;
        this.#imageOid = data.image_oid;
        this.#encrypted = data.encrypted;
        this.#lastModified = new Date( data.last_modified );
        this.#contentType = data.content_type;
        this.#cacheControl = data.cache_control;
        this.#contentDisposition = data.content_disposition;
        this.#contentLength = data.size;
        this.#inactiveMaxAge = data.inactive_max_age
            ? Interval.new( data.inactive_max_age )
            : null;
        this.#expires = data.expired;
        this.#etag = data.hash;

        this.#headers = {
            "etag": Headers.createEtag( data.hash ),
            "accept-ranges": "bytes",
            "last-modified": this.lastModified.toUTCString(),
        };

        if ( this.contentType ) this.#headers[ "content-type" ] = this.contentType;
        if ( this.cacheControl ) this.#headers[ "cache-control" ] = this.cacheControl;
        if ( this.contentDisposition ) this.#headers[ "content-disposition" ] = this.contentDisposition;
    }

    // properties
    get id () {
        return this.#id;
    }

    get path () {
        return this.#path;
    }

    get name () {
        this.#name ??= path.basename( this.#path );

        return this.#name;
    }

    get size () {
        return this.#size;
    }

    get imageId () {
        return this.#imageId;
    }

    get imagePath () {
        return this.#imagePath;
    }

    get imageOid () {
        return this.#imageOid;
    }

    get isEncrypted () {
        return this.#encrypted;
    }

    get lastModified () {
        return this.#lastModified;
    }

    get contentType () {
        return this.#contentType;
    }

    get cacheControl () {
        return this.#cacheControl;
    }

    get contentDisposition () {
        return this.#contentDisposition;
    }

    get contentLength () {
        return this.#contentLength;
    }

    get inactiveMaxAge () {
        return this.#inactiveMaxAge;
    }

    get expires () {
        return this.#expires;
    }

    get etag () {
        return this.#etag;
    }

    get location () {
        this.#location ??= this.#cache.storage.locations.getLocation( this.path );

        return this.#location;
    }

    // public
    setExpires ( value ) {
        this.#expires = value;
    }

    getHeaders () {
        return { ...this.#headers };
    }

    toJSON () {
        return {
            "id": this.id,
            "path": this.path,
            "name": this.name,
            "size": this.size,
            "isEncrypted": this.isEncrypted,
            "lastModified": this.lastModified,
            "contentType": this.contentType,
            "cacheControl": this.cacheControl,
            "contentDisposition": this.contentDisposition,
            "expires": this.expires,
            "inactiveMaxAge": this.inactiveMaxAge,
            "etag": this.etag,
        };
    }
}
