import { validatePath } from "#lib/validate";

export default [
    {
        "keyword": "path",
        "type": "string",
        "metaSchema": {
            "type": "object",
            "properties": {
                "root": { "type": "boolean" },
                "directory": { "type": "boolean" },
                "absolute": { "type": "boolean" },
                "format": {
                    "enum": [ "kebab-case", "snake-case", "constant-case", "cames-case", "pascal-case" ],
                },
            },
            "additionalProperties": false,
            "required": [],
        },
        "errors": false,
        compile ( schema, parentSchema, it ) {
            const { root, absolute, directory, format } = schema;

            return function validator ( data ) {
                return validatePath( data, {
                    root,
                    absolute,
                    directory,
                    format,
                } );
            };
        },
    },
];
