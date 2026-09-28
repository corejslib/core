// DOCS: https://docs.github.com/en/rest/repos/repos

export default Super =>
    class extends ( Super || class {} ) {

        // public
        // https://docs.github.com/en/rest/repos/repos#get-a-repository
        async getRepository ( repositorySlug ) {
            return this._doRequest( "GET", `repos/${ repositorySlug }` );
        }

        // https://docs.github.com/en/rest/repos/repos#update-a-repository
        async updateRepository ( repositorySlug, data ) {
            return this._doRequest( "PATCH", `repos/${ repositorySlug }`, {
                "body": JSON.stringify( data ),
            } );
        }

        // https://docs.github.com/en/rest/repos/repos#check-if-dependabot-security-updates-are-enabled-for-a-repository
        async getDependabotsecurityupdatesEnabled ( repositorySlug ) {
            return this._doRequest( "GET", `repos/${ repositorySlug }/automated-security-fixes` );
        }

        // https://docs.github.com/en/rest/repos/repos#enable-dependabot-security-updates
        // https://docs.github.com/en/rest/repos/repos#disable-dependabot-security-updates
        async setDependabotsecurityupdateEnabled ( repositorySlug, enabled ) {
            return this._doRequest( enabled
                ? "PUT"
                : "DELETE", `repos/${ repositorySlug }/automated-security-fixes` );
        }

        // https://docs.github.com/en/rest/repos/repos#check-if-private-vulnerability-reporting-is-enabled-for-a-repository
        async getPrivateVulnerabilityReportingEnabled ( repositorySlug ) {
            return this._doRequest( "GET", `repos/${ repositorySlug }/private-vulnerability-reporting` );
        }

        // https://docs.github.com/en/rest/repos/repos#enable-private-vulnerability-reporting-for-a-repository
        // https://docs.github.com/en/rest/repos/repos#disable-private-vulnerability-reporting-for-a-repository
        async setPrivateVulnerabilityReportingEnabled ( repositorySlug, enabled ) {
            return this._doRequest( enabled
                ? "PUT"
                : "DELETE", `repos/${ repositorySlug }/private-vulnerability-reporting` );
        }

        // https://docs.github.com/en/rest/repos/repos#check-if-vulnerability-alerts-are-enabled-for-a-repository
        async getVulnerabilityAlertsEnabled ( repositorySlug ) {
            const res = await this._doRequest( "GET", `repos/${ repositorySlug }/vulnerability-alerts` );

            if ( res.ok ) {
                return result( 200, { "enabled": true }, res.meta );
            }
            else if ( res.status === 404 ) {
                return result( 200, { "enabled": false }, res.meta );
            }
            else {
                return res;
            }
        }

        // https://docs.github.com/en/rest/repos/repos#enable-vulnerability-alerts
        // https://docs.github.com/en/rest/repos/repos#disable-vulnerability-alerts
        async setVulnerabilityAlertsEnabled ( repositorySlug, enabled ) {
            return this._doRequest( enabled
                ? "PUT"
                : "DELETE", `repos/${ repositorySlug }/vulnerability-alerts` );
        }
    };
