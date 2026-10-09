import MessageBuffer from "#lib/data-structures/message-buffer";

export default class PostgreSqlMessageBuffer extends MessageBuffer {
    #msgOffset;

    // public
    beginMsg ( id ) {
        if ( id !== "" ) this.write( id );

        this.#msgOffset = this.offset;

        return this.writeUint32( 0 );
    }

    endMsg () {
        this.writeUint32( this.offset - this.#msgOffset, this.#msgOffset );

        this.#msgOffset = null;

        return this;
    }
}
