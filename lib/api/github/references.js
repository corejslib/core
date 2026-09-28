// DOCS: https://docs.github.com/en/rest/git/refs

export default Super =>
    class extends ( Super || class {} ) {

        // public
        // DOCS: https://docs.github.com/en/rest/git/refs#list-matching-references
        async listMatchingReferences ( repositorySlug, ref ) {
            return this._doRequest( "GET", `repos/${ repositorySlug }/git/matching-refs/${ ref || "" }` );
        }
    };
