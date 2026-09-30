import "#lib/temporal";
import { isIP } from "node:net";
import CronExpression from "#lib/cron/expression";
import { isValidMonthName, isValidTimeZone, isValidWeekdayName } from "#lib/dates";
import DigitalSize from "#lib/digital-size";
import GlobPattern from "#lib/glob/pattern";
import Hostname from "#lib/hostname";
import Interval from "#lib/interval";
import IpRange from "#lib/ip/range";
import Locale from "#lib/locale";
import * as namingConventions from "#lib/naming-conventions";
import SemanticVersion from "#lib/semantic-version";
import { validateTelegramUsername } from "#lib/validate";

const temporalOverflow = "reject"; // constrain

function validatePort ( port, { allowRandom } = {} ) {
    port = +port;

    return Number.isInteger( port ) && port >= ( allowRandom
        ? 0
        : 1 ) && port <= 65_535;
}

export default {
    "kebab-case": {
        "type": "string",
        "validate": namingConventions.isKebabCase,
    },

    "kebab-case-relative-file-path": {
        "type": "string",
        "validate": value => {
            return namingConventions.validatePath( value, {
                "root": false,
                "absolute": false,
                "folder": false,
                "format": "kebab-case",
            } );
        },
    },

    "kebab-case-root-or-absolute-file-path": {
        "type": "string",
        "validate": value => {
            return namingConventions.validatePath( value, {
                "root": true,
                "absolute": true,
                "folder": false,
                "format": "kebab-case",
            } );
        },
    },

    "kebab-case-root-or-absolute-folder-path": {
        "type": "string",
        "validate": value => {
            return namingConventions.validatePath( value, {
                "root": true,
                "absolute": true,
                "folder": true,
                "format": "kebab-case",
            } );
        },
    },

    "kebab-case-absolute-file-path": {
        "type": "string",
        "validate": value => {
            return namingConventions.validatePath( value, {
                "root": false,
                "absolute": true,
                "folder": false,
                "format": "kebab-case",
            } );
        },
    },

    "kebab-case-absolute-folder-path": {
        "type": "string",
        "validate": value => {
            return namingConventions.validatePath( value, {
                "root": false,
                "absolute": true,
                "folder": true,
                "format": "kebab-case",
            } );
        },
    },

    "glob-pattern": {
        "type": "string",
        "validate": GlobPattern.isValid.bind( GlobPattern ),
    },

    "snake-case": {
        "type": "string",
        "validate": namingConventions.isSnakeCase,
    },

    "camel-case-strict": {
        "type": "string",
        "validate": value => namingConventions.isCamelCase( value, { "strict": true } ),
    },

    "semantic-version": {
        "type": "string",
        "validate": SemanticVersion.isValid.bind( SemanticVersion ),
    },

    "telegram-username": {
        "type": "string",
        "validate": value => validateTelegramUsername( value ).ok,
    },

    "cron": {
        "type": "string",
        "validate": CronExpression.isValid.bind( CronExpression ),
    },

    "url": {
        "type": "string",
        "validate": URL.canParse,
    },

    "ip-address": {
        "type": "string",
        "validate": value => Boolean( isIP( value ) ),
    },

    "ip-port": {
        "type": "number",
        "validate": validatePort,
    },

    "random-ip-port": {
        "type": "number",
        "validate": value => validatePort( value, { "allowRandom": true } ),
    },

    "ip-address+port": {
        "type": "string",
        "validate": value => {
            try {
                const [ hostname, port ] = value.split( ":", 2 );

                if ( !isIP( hostname ) ) return false;

                return validatePort( port );
            }
            catch {
                return false;
            }
        },
    },

    "ip-subnet": {
        "type": "string",
        "validate": IpRange.isValid.bind( IpRange ),
    },

    "int2": {
        "type": "integer",
        "validate": value => value >= -32_768 && value <= 32_767,
    },

    "int4": {
        "type": "integer",
        "validate": value => value >= -2_147_483_648 && value <= 2_147_483_647,
    },

    "int8": {
        "type": "string",
        "validate": value => {
            try {
                value = BigInt( value );

                return value >= -9_223_372_036_854_775_808n && value <= 9_223_372_036_854_775_807n;
            }
            catch {
                return false;
            }
        },
    },

    "locale": {
        "type": "string",
        "validate": Locale.isValid,
    },

    "language": {
        "type": "string",
        "validate": Locale.languageisValid,
    },

    "digital-size": {
        "type": "string",
        validate ( value ) {
            if ( !value ) return false;

            try {
                const size = DigitalSize.new( value );

                if ( !size.hasValue ) return false;

                return true;
            }
            catch {
                return false;
            }
        },
    },

    "interval": {
        "type": "string",
        "validate": value => {
            if ( !value ) return false;

            try {
                const interval = new Interval( value );

                if ( !interval.hasValue ) return false;

                return true;
            }
            catch {
                return false;
            }
        },
    },

    "host-name": {
        "type": "string",
        "validate": value => {
            try {
                const hostname = new Hostname( value );

                return hostname.isValid;
            }
            catch {
                return false;
            }
        },
    },

    "host-name+port": {
        "type": "string",
        "validate": value => {
            try {
                var [ hostname, port ] = value.split( ":", 2 );

                hostname = new Hostname( hostname );

                if ( !hostname.isValid ) return false;

                return validatePort( port );
            }
            catch {
                return false;
            }
        },
    },

    "domain-name": {
        "type": "string",
        "validate": value => {
            try {
                const hostname = new Hostname( value );

                return hostname.isDomain && hostname.isValid;
            }
            catch {
                return false;
            }
        },
    },

    "domain-name+port": {
        "type": "string",
        "validate": value => {
            try {
                var [ hostname, port ] = value.split( ":", 2 );

                hostname = new Hostname( hostname );

                if ( !hostname.isDomain || !hostname.isValid ) return false;

                return validatePort( port );
            }
            catch {
                return false;
            }
        },
    },

    "nginx-server-name": {
        "type": "string",
        validate ( value ) {
            try {
                if ( value.startsWith( "*." ) ) value = value.slice( 2 );

                const hostname = new Hostname( value );

                return hostname.isDomain && hostname.isValid;
            }
            catch {
                return false;
            }
        },
    },

    "epoch-seconds": {
        "type": "integer",
        validate ( value ) {
            return value >= 0;
        },
    },

    "epoch-milliseconds": {
        "type": "integer",
        validate ( value ) {
            return value >= 0;
        },
    },

    "epoch-nanoseconds": {
        "type": "string",
        validate ( value ) {
            return BigInt( value ) >= 0n;
        },
    },

    "instant-date-time": {
        "type": "string",
        validate ( value ) {
            try {
                Temporal.Instant.from( value );

                return true;
            }
            catch {
                return false;
            }
        },
    },

    "zoned-date-time": {
        "type": "string",
        validate ( value ) {
            try {
                Temporal.ZonedDateTime.from( value, {
                    "overflow": temporalOverflow,
                } );

                return true;
            }
            catch {
                return false;
            }
        },
    },

    "plain-date-time": {
        "type": "string",
        validate ( value ) {
            try {
                Temporal.PlainDateTime.from( value, {
                    "overflow": temporalOverflow,
                } );

                return true;
            }
            catch {
                return false;
            }
        },
    },

    "plain-date": {
        "type": "string",
        validate ( value ) {
            try {
                Temporal.PlainDate.from( value, {
                    "overflow": temporalOverflow,
                } );

                return true;
            }
            catch {
                return false;
            }
        },
    },

    "plain-time": {
        "type": "string",
        validate ( value ) {
            try {
                Temporal.PlainTime.from( value, {
                    "overflow": temporalOverflow,
                } );

                return true;
            }
            catch {
                return false;
            }
        },
    },

    "plain-month-day": {
        "type": "string",
        validate ( value ) {
            try {
                Temporal.PlainMonthDay.from( value, {
                    "overflow": temporalOverflow,
                } );

                return true;
            }
            catch {
                return false;
            }
        },
    },

    "plain-year-month": {
        "type": "string",
        validate ( value ) {
            try {
                Temporal.PlainYearMonth.from( value, {
                    "overflow": temporalOverflow,
                } );

                return true;
            }
            catch {
                return false;
            }
        },
    },

    "month-name": {
        "type": "string",
        "validate": isValidMonthName,
    },

    "weekday-name": {
        "type": "string",
        "validate": isValidWeekdayName,
    },

    "timezone": {
        "type": "string",
        "validate": isValidTimeZone,
    },

    "duration": {
        "type": "string",
        validate ( value ) {
            try {
                Temporal.Duration.from( value );

                return true;
            }
            catch {
                return false;
            }
        },
    },
};
