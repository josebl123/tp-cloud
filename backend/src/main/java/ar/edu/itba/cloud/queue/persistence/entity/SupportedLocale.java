package ar.edu.itba.cloud.queue.persistence.entity;

import java.util.Locale;

/**
 * The languages the product speaks.
 *
 * <p>Stored on each queue entry so a notification sent hours after someone joined still arrives in
 * the language they were reading when they took their place. Anything unrecognised falls back to
 * {@link #EN} rather than failing: a customer should never be turned away over a locale header.
 */
public enum SupportedLocale {
    EN("en"),
    ES("es");

    public static final SupportedLocale DEFAULT = EN;

    private final String languageTag;

    SupportedLocale(String languageTag) {
        this.languageTag = languageTag;
    }

    public String languageTag() {
        return languageTag;
    }

    public Locale toLocale() {
        return Locale.forLanguageTag(languageTag);
    }

    /**
     * Resolves a language tag or an {@code Accept-Language} header value.
     *
     * <p>Handles the shapes a browser actually sends: {@code es}, {@code es-AR}, and a weighted list
     * such as {@code es-AR,es;q=0.9,en;q=0.8}. Only the primary language subtag matters here.
     */
    public static SupportedLocale fromTag(String value) {
        if (value == null || value.isBlank()) {
            return DEFAULT;
        }
        String primary = value.split(",")[0].split(";")[0].trim();
        int separator = primary.indexOf('-');
        String language = (separator > 0 ? primary.substring(0, separator) : primary)
                .toLowerCase(Locale.ROOT);

        for (SupportedLocale candidate : values()) {
            if (candidate.languageTag.equals(language)) {
                return candidate;
            }
        }
        return DEFAULT;
    }
}
