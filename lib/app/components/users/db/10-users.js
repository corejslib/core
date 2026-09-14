import sql from "#lib/sql";

export default sql`

CREATE EXTENSION IF NOT EXISTS softvisio_types;

-- user
CREATE SEQUENCE user_id_seq AS int8 MAXVALUE ${ Number.MAX_SAFE_INTEGER };

CREATE TABLE "user" (
    id int53 PRIMARY KEY DEFAULT nextval( 'user_id_seq' ),
    email text NOT NULL UNIQUE,
    created timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity timestamptz,
    enabled boolean NOT NULL DEFAULT TRUE,
    locale text,
    email_confirmed boolean NOT NULL DEFAULT FALSE
);

ALTER SEQUENCE user_id_seq OWNED BY "user".id;

CREATE TABLE user_password_hash (
    user_id int53 PRIMARY KEY REFERENCES "user" ( id ) ON DELETE CASCADE,
    hash text NOT NULL
);

-- after delete user
CREATE FUNCTION user_after_delete_trigger () RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify( 'users/user/delete', json_build_object(
        'id', OLD.id
    )::text );

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_after_delete AFTER DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION user_after_delete_trigger();

-- after update user
CREATE FUNCTION user_after_update_trigger () RETURNS TRIGGER AS $$
DECLARE
    v_data jsonb;
BEGIN
    IF OLD.enabled != NEW.enabled THEN
        SELECT jsonb_set_lax( coalesce( v_data, '{}' ), '{enabled}', to_jsonb( NEW.enabled ), TRUE, 'use_json_null' ) INTO v_data;
    END IF;

    IF OLD.locale != NEW.locale THEN
        SELECT jsonb_set_lax( coalesce( v_data, '{}' ), '{locale}', to_jsonb( NEW.locale ), TRUE, 'use_json_null' ) INTO v_data;
    END IF;

    IF OLD.email != NEW.email THEN
        SELECT jsonb_set_lax( coalesce( v_data, '{}' ), '{email}', to_jsonb( NEW.email ), TRUE, 'use_json_null' ) INTO v_data;
    END IF;

    IF OLD.email_confirmed != NEW.email_confirmed THEN
        SELECT jsonb_set_lax( coalesce( v_data, '{}' ), '{email_confirmed}', to_jsonb( NEW.email_confirmed ), TRUE, 'use_json_null' ) INTO v_data;
    END IF;

    IF v_data IS NOT NULL THEN
        SELECT jsonb_set( v_data, '{id}', to_jsonb( NEW.id ), TRUE ) INTO v_data;

        PERFORM pg_notify( 'users/user/update', v_data::text );
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER user_after_update AFTER UPDATE OF email, enabled, locale, email_confirmed ON "user" FOR EACH ROW EXECUTE FUNCTION user_after_update_trigger();

-- after update user password hash
CREATE FUNCTION user_password_hash_after_update_trigger () RETURNS TRIGGER AS $$
BEGIN

    PERFORM pg_notify( 'users/user-password-hash/update', json_build_object(
        'id', NEW.user_id,
        'password_hash', NEW.hash
    )::text );

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_password_hash_after_update AFTER UPDATE ON user_password_hash FOR EACH ROW EXECUTE FUNCTION user_password_hash_after_update_trigger();

`;
