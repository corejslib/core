import ansi from "#lib/ansi";
import Markdown from "#lib/markdown";

const useAnsi = process.stdout.isTTY;

export function markdownToString ( string ) {
    return new Markdown( string )
        .toString( {
            "ansi": useAnsi,
        } )
        .trim();
}

export function applyFalseStyle ( string ) {
    if ( useAnsi ) {
        return ansi.brightRed( string );
    }
    else {
        return string;
    }
}

export function removeAnsi ( string ) {
    return ansi.remove( string );
}
