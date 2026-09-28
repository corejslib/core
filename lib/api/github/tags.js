// DOCS: https://docs.github.com/en/rest/git/tags

export default Super =>
    class extends ( Super || class {} ) {

        // public
        // DOCS: https://docs.github.com/en/rest/git/tags#get-a-tag
        async getTag ( repositorySlug, tagSha ) {
            return this._doRequest( "GET", `repos/${ repositorySlug }/tags/${ tagSha }` );
        }
    };
