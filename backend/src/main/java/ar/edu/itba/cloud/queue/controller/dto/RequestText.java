package ar.edu.itba.cloud.queue.controller.dto;

/**
 * Whitespace handling for text arriving over HTTP.
 *
 * <p>Applied in the records' canonical constructors so it happens <em>before</em> bean validation:
 * a padded address pasted from a phone keyboard should be accepted and cleaned, not rejected as
 * malformed, and a field containing only spaces should read as absent rather than present.
 */
final class RequestText {

    private RequestText() {
    }

    static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
