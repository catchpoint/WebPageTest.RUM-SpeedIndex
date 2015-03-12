# Boomerang wrapper around RUM-SpeedIndex

Forked from https://github.com/WPO-Foundation/RUM-SpeedIndex

Calculate SpeedIndex measurements from the field using Resource Timings

This is still in the early testing stages and there are a few caveats to be aware of:
* Only works for browsers that support Resource Timings (most modern browsers except Safari)
* Does not handle content within iframes (possible, just not implemented yet)
* Works better for IE and Chrome which both support reporting a "first paint" event