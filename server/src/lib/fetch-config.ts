import { Agent, setGlobalDispatcher } from "undici";

/**
 * Node's built-in fetch (undici) has been observed to fail outbound
 * requests on some container hosts (Render, Railway, etc.) with a
 * generic, low-detail error — connects that would succeed with a
 * slightly longer timeout instead throw a bare ErrorEvent with no
 * status code at all. This isn't specific to our code or our GitHub
 * API calls; it's a known rough edge with undici's default connect
 * timeout in containerized/virtualized network environments.
 *
 * Raising the connect timeout (default is 10s) gives flaky outbound
 * connections more room to succeed instead of aborting early. This
 * must run once, before any other module calls fetch — imported as
 * the very first line of index.ts.
 */
setGlobalDispatcher(
  new Agent({
    connect: { timeout: 30_000 },
  })
);
