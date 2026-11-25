// NOTE: https://docs.github.com/en/rest/releases/releases

export default Super =>
    class extends ( Super || class {} ) {

        // public
        // https://docs.github.com/en/rest/releases/releases#list-releases
        async listReleases ( repositorySlug, { limit = 100 } = {} ) {
            var page = 1,
                perPage = 100;

            const data = [];

            while ( true ) {
                if ( limit ) {
                    perPage = limit - data.length;

                    if ( perPage > 190 ) perPage = 100;
                }

                const res = await this._doRequest( "GET", `repos/${ repositorySlug }/releases`, {
                    "search": {
                        page,
                        "per_page": perPage,
                    },
                } );

                if ( !res.ok ) return res;

                data.push( ...res.data );

                // max. records fetched
                if ( data.length === 1000 ) {
                    break;
                }

                // more data required
                if ( !limit || limit > data.length ) {

                    // no more data available
                    if ( res.data.length < 100 ) {
                        break;
                    }
                    else {
                        page++;
                    }
                }

                // all data fetched
                else {
                    break;
                }
            }

            return result( 200, data );
        }

        // https://docs.github.com/en/rest/releases/releases#get-the-latest-release
        async getLatestRelease ( repositorySlug ) {
            return this._doRequest( "GET", `repos/${ repositorySlug }/releases/latest` );
        }

        // https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name
        async getReleaseByTagName ( repositorySlug, tagName ) {
            return this._doRequest( "GET", `repos/${ repositorySlug }/releases/tags/${ tagName }` );
        }

        // https://docs.github.com/en/rest/releases/assets#list-release-assets
        // XXX fetch all pages
        async listReleaseAssets ( repositorySlug, releaseId ) {
            return this._doRequest( "GET", `repos/${ repositorySlug }/releases/${ releaseId }/assets`, {
                "search": {
                    "per_page": 100,
                },
            } );
        }

        // https://docs.github.com/en/rest/releases/assets#delete-a-release-asset
        async deleteReleaseAsset ( repositorySlug, assetId ) {
            return this._doRequest( "DELETE", `repos/${ repositorySlug }/releases/assets/${ assetId }` );
        }

        // https://docs.github.com/en/rest/releases/assets#upload-a-release-asset
        async uploadReleaseAsset ( repositorySlug, releaseId, file ) {
            return this._doRequest( "POST", `https://uploads.github.com/repos/${ repositorySlug }/releases/${ releaseId }/assets`, {
                "search": {
                    "name": file.name,
                },
                "body": file,
            } );
        }

        // https://docs.github.com/en/rest/releases/releases#create-a-release
        async createRelease ( repositorySlug, tagName, { name, body, prerelease, targetCommitish, draft, discussionCategoryName } = {} ) {
            return this._doRequest( "POST", `repos/${ repositorySlug }/releases`, {
                "body": JSON.stringify( {
                    "tag_name": tagName,
                    name,
                    body,
                    prerelease,
                    "target_commitish": targetCommitish,
                    draft,
                    "discussion_category_name": discussionCategoryName,
                } ),
            } );
        }

        async downloadReleaseAssetByUrl ( url ) {
            return this._doRequest( "GET", url, {
                "headers": {
                    "accept": "application/octet-stream",
                },
                "rateLimit": true,
                "download": true,
            } );
        }

        async updateReleaseAsset ( repositorySlug, releaseId, file ) {

            // get assets
            var res = await this.listReleaseAssets( repositorySlug, releaseId );
            if ( !res.ok ) return res;

            // find and remove asset
            for ( const asset of res.data ) {
                if ( asset.name === file.name ) {
                    res = await this.deleteReleaseAsset( repositorySlug, asset.id );
                    if ( !res.ok ) return res;

                    break;
                }
            }

            res = await this.uploadReleaseAsset( repositorySlug, releaseId, file );

            return res;
        }

        async downloadReleaseAssetByName ( repositorySlug, releaseId, name ) {

            // get assets
            var res = await this.listReleaseAssets( repositorySlug, releaseId );
            if ( !res.ok ) return res;

            let url;

            // find asset
            for ( const asset of res.data ) {
                if ( asset.name === name ) {
                    url = asset.url;

                    break;
                }
            }

            if ( !url ) return result( 404 );

            return this.downloadReleaseAssetByUrl( url );
        }
    };
