# Utils

```javascript
import * as utils from "@corejslib/utils";
```

### utils.sleep( timeout )

- `timeout` {integer} Timeout to sleep.
- Returns: {Promise} Resolves when timeout passed.

### utils.getRandomArrayIndex( array )

- `array` {Array}
- Returns: {integer} Random array index.

### utils.getRandomArrayValue( array )

- `array` {Array}
- Returns: {any} Random array value.

### utils.isPlainObject( object )

- `object` {Object} Object to check.
- Returns: {boolean} `true` if `object` is plain object.

### utils.isEmptyObject( object )

- `object` {Object} Object to check.
- Returns: {boolean} `true` if `object` has no properties.

### utils.objectPick( object, keys )

- `object` {Object} Source object.
- `keys` {string\[]} Keys to pick.
- Returns: {Object} New object, with the selected properties copied from the source object.

### utils.objectOmit( object, keys )

- `object` {Object} Source object.
- `keys` {string\[]} Keys to omin.
- Returns: {Object} New object, with the all properties copied from the source object, exceping omitted.

### utils.confirm( text, options )

- `text` {string} Prompt.
- `options` {string\[]} Answers. First element become default answer.
- Returns: {Promise} Fulfils with the user input.

### utils.resolve( path, module )

- `path` {string} Path to resolve.
- `module` {string} Module to resolve path from.
- Returns: {string} Absolute resolved path as file URL.

This function will be removed when node `import.meta.resolve()` will be released.

## Net

```javascript
import * as net from "@corejslib/core/utils/net";
```

### net.getDefaultPort( protocol )

- `protocol` {string} URL protocol.
- Returns: {integer} Default port for the specified protocol.

Default ports:

| Protocol        | Default port |
| --------------- | -----------: |
| ftp:            |           21 |
| ftps:           |          990 |
| gopher:         |           70 |
| http:           |           80 |
| https:          |          443 |
| ws:             |           80 |
| wss:            |          443 |
| postgresql:     |         5432 |
| postgresql+tls: |         5432 |
| redis:          |         6379 |
| redis+tls:      |         6379 |
| smtp:           |           25 |
| smtp+tls:       |          465 |
| smtp+starttls:  |          587 |
| ssh:            |           22 |

### net.getRandomFreePort( hostname )

- `hostname` {string} IP address or host name.
- Returns: `integer\` Fulfils with the random free port for the specified host name.

### net.isPortFree( port, hostname )

- `port` {integer} Port to check.
- `hostname` {string} IP address or host name to check port.
- Returns: {Promise} Fulfils with the {boolean} `true` if port is not used.

### net.tryConnect( port, hostname )

- `port` {integer} Port to connect to.
- `hostname` {string} IP address or host name to connect to.
- Returns: {Promise} Fulfils with the {boolean} `true` if a connection is established.
