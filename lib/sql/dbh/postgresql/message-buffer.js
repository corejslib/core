import MessageBuffer from "#lib/data-structures/message-buffer";

export default class PostgreSqlMessageBuffer extends MessageBuffer {
    #msgPos = 0;

    // public
    beginMsg ( id ) {
        if ( id !== "" ) this.write( id );

        this.#msgPos = this.offset;

        return this.writeUint32( 0 );
    }

    endMsg () {
        this.buffer.writeUint32( this.offset - this.#msgPos, this.#msgPos );

        this.#msgPos = null;

        return this;
    }
}
