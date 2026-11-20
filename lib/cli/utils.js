import Markdown from "#lib/markdown";

export function markdownToString ( string ) {
    return new Markdown( string )
        .toString( {
            "ansi": process.stdout.isTTY,
        } )
        .trim();
}
