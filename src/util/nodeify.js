/**
 * Converts a promise-returning function into a Node-style function,
 * but only an extra callback argument is actually passed in.
 */
export function nodeify (f) {
  return function () {
    const promise = f.apply(this, arguments)

    // Figure out what to do with the promise:
    const callback = arguments[arguments.length - 1]
    if (f.length < arguments.length && typeof callback === 'function') {
      promise.then(reply => callback(null, reply)).catch(e => callback(e))
    } else {
      return promise
    }
  }
}
