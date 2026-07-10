function debounceWithFlush(fn, wait) {
  let timeout = null;
  let lastArgs;
  let lastThis;

  function invoke() {
    const args = lastArgs;
    const context = lastThis;
    timeout = null;
    lastArgs = undefined;
    lastThis = undefined;
    return fn.apply(context, args);
  }

  function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    if (timeout !== null) clearTimeout(timeout);
    timeout = setTimeout(invoke, wait);
  }

  debounced.flush = function () {
    if (timeout === null) return;
    clearTimeout(timeout);
    return invoke();
  };

  debounced.cancel = function () {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    lastArgs = undefined;
    lastThis = undefined;
  };

  return debounced;
}