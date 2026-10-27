# SASL

```javascript
import Sasl from "@corejslib/core/sasl";

const sasl = new Sasl( [ "PLAIN", "LOGIN" ], "user", "password" );
```

## Class: Sasl

### new Sasl( methods, username, password )

- `methods` {string\[]} Authentication methods supported by the server.
- `username` {string} Username used for authentication.
- `password` {string} Password used for authentication.
- Returns: {Sasl}.

Supported authentication methods, in selection priority order:

- `SCRAM-SHA-256`
- `CRAM-MD5`
- `LOGIN`
- `PLAIN`

Selects the first method supported by the server.

### sasl.username

- Returns: {string} Username provided to the constructor.

### sasl.password

- Returns: {string} Password provided to the constructor.

### sasl.method

- Returns: {string|undefined} Selected authentication method, or `undefined` if none is supported.

### sasl.continue( response? )

- `response?` {string} Server response for the current authentication step.
- Returns: {string|boolean|undefined} Client response, `true` when SCRAM authentication succeeds, or `undefined` when the exchange cannot continue.

Process a server response and return the next client response in the selected authentication exchange.
