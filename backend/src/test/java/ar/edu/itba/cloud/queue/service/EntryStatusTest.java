package ar.edu.itba.cloud.queue.service;

import static org.assertj.core.api.Assertions.assertThat;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

@DisplayName("Entry status classification")
class EntryStatusTest {

    @ParameterizedTest
    @EnumSource(value = EntryStatus.class, names = {"WAITING", "CALLED", "SERVING"})
    @DisplayName("statuses that still hold a place in the line are active")
    void activeStatuses(EntryStatus status) {
        assertThat(status.isActive()).isTrue();
        assertThat(status.isTerminal()).isFalse();
        assertThat(EntryStatus.active()).contains(status);
    }

    @ParameterizedTest
    @EnumSource(value = EntryStatus.class, names = {"SERVED", "LEFT", "NO_SHOW"})
    @DisplayName("statuses that end the customer's pass through the queue are terminal")
    void terminalStatuses(EntryStatus status) {
        assertThat(status.isTerminal()).isTrue();
        assertThat(status.isActive()).isFalse();
        assertThat(EntryStatus.active()).doesNotContain(status);
    }
}
