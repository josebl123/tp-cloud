package ar.edu.itba.cloud.queue.controller;

import jakarta.servlet.http.HttpServletResponse;

/**
 * Response headers a Server-Sent Events endpoint needs to survive the path between the server and the
 * browser.
 *
 * <p>An event stream is a response that is deliberately never finished, which is exactly the shape
 * intermediaries like to buffer or cache. In front of this application there are two of them - a load
 * balancer and a CDN - and either one holding bytes back would turn live updates into nothing at all
 * until the connection eventually closed.
 */
final class Streams {

    private Streams() {
    }

    static void prepare(HttpServletResponse response) {
        // no-transform additionally forbids a proxy from re-encoding (and therefore buffering) the body.
        response.setHeader("Cache-Control", "no-cache, no-store, no-transform");
        // Understood by nginx and several CDNs as "forward this byte by byte".
        response.setHeader("X-Accel-Buffering", "no");
    }
}
