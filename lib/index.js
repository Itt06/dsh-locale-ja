/**
 * DSH locale-ja bundle, node half.
 *
 * The empty apply gives Loader a host-side row; the browser half ships through
 * `exports["./client"]` and is served by the runtime's `/plugins` route. That
 * half registers the `ja` locale with one dictionary per official namespace and
 * applies a Japanese-first font stack.
 */
function apply() {}

export { apply }
