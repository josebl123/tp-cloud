package ar.edu.itba.cloud.queue.service;

import static org.assertj.core.api.Assertions.assertThat;

import ar.edu.itba.cloud.queue.persistence.entity.SupportedLocale;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

@DisplayName("Locale resolution")
class SupportedLocaleTest {

    @ParameterizedTest
    @CsvSource({
            "es, ES",
            "es-AR, ES",
            "ES-ar, ES",
            "en, EN",
            "en-US, EN",
    })
    @DisplayName("resolves a plain language tag, with or without a region")
    void resolvesLanguageTags(String tag, SupportedLocale expected) {
        assertThat(SupportedLocale.fromTag(tag)).isEqualTo(expected);
    }

    @ParameterizedTest
    @CsvSource({
            "'es-AR,es;q=0.9,en;q=0.8', ES",
            "'en-GB,en;q=0.9,es;q=0.5', EN",
            "'es;q=1.0', ES",
    })
    @DisplayName("reads the first entry of a weighted Accept-Language header")
    void resolvesAcceptLanguageHeaders(String header, SupportedLocale expected) {
        assertThat(SupportedLocale.fromTag(header)).isEqualTo(expected);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = { "  ", "fr", "pt-BR", "zh-Hans", "gibberish" })
    @DisplayName("falls back to English rather than failing on anything unsupported")
    void fallsBackToDefault(String tag) {
        assertThat(SupportedLocale.fromTag(tag)).isEqualTo(SupportedLocale.EN);
    }

    @Test
    @DisplayName("exposes a usable java.util.Locale")
    void exposesJavaLocale() {
        assertThat(SupportedLocale.ES.toLocale().getLanguage()).isEqualTo("es");
        assertThat(SupportedLocale.EN.toLocale().getLanguage()).isEqualTo("en");
    }
}
