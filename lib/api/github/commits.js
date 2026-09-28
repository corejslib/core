// DOCS: https://docs.github.com/en/rest/commits/commits

export default Super =>
    class extends ( Super || class {} ) {

        // public
        // DOCS: https://docs.github.com/en/rest/commits/commits#get-a-commit
        async getCommit ( repositorySlug, commitRef ) {
            return this._doRequest( "GET", `repos/${ repositorySlug }/commits/${ commitRef }` );
        }
    };
