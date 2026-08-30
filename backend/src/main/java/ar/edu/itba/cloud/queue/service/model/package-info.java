/**
 * Read models returned by the service layer.
 *
 * <p>These are the boundary between persistence and HTTP: JPA entities never leave the service layer,
 * and controllers never see them. Records here are immutable and safe to serialise directly.
 */
package ar.edu.itba.cloud.queue.service.model;
