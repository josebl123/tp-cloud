package ar.edu.itba.cloud.queue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ar.edu.itba.cloud.queue.config.AppProperties;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.Establishment;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.repository.EntryTimings;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;

@ExtendWith(MockitoExtension.class)
@DisplayName("Waiting time estimation")
class EstimationServiceTest {

    private static final Instant NOW = Instant.parse("2026-03-01T12:00:00Z");

    @Mock
    private QueueEntryRepository entryRepository;

    private EstimationService estimationService;
    private ServiceQueue queue;

    @BeforeEach
    void setUp() {
        estimationService = new EstimationService(entryRepository, properties(10));
        queue = new ServiceQueue(new Establishment("Demo", "UTC", NOW), "Mesas", NOW);
        queue.setDefaultServiceMinutes(5);
        queue.setServiceStations(1);
    }

    @Test
    @DisplayName("falls back to the queue default when there is no service history")
    void fallsBackToConfiguredDefault() {
        when(entryRepository.findRecentServiceTimings(any(), any(Pageable.class))).thenReturn(List.of());

        EstimationService.ServiceTimeEstimate estimate = estimationService.averageServiceTime(queue);

        assertThat(estimate.usingDefault()).isTrue();
        assertThat(estimate.duration()).isEqualTo(Duration.ofMinutes(5));
        assertThat(estimate.sampleCount()).isZero();
    }

    @Test
    @DisplayName("averages the recent completed services once there is history")
    void averagesRecentServices() {
        when(entryRepository.findRecentServiceTimings(any(), any(Pageable.class)))
                .thenReturn(List.of(served(Duration.ofMinutes(4)), served(Duration.ofMinutes(8))));

        EstimationService.ServiceTimeEstimate estimate = estimationService.averageServiceTime(queue);

        assertThat(estimate.usingDefault()).isFalse();
        assertThat(estimate.duration()).isEqualTo(Duration.ofMinutes(6));
        assertThat(estimate.sampleCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("ignores samples with no measurable service time")
    void ignoresUnmeasurableSamples() {
        when(entryRepository.findRecentServiceTimings(any(), any(Pageable.class)))
                .thenReturn(List.of(
                        new EntryTimings(EntryStatus.SERVED, NOW, NOW, null, NOW.plusSeconds(600)),
                        served(Duration.ofMinutes(10))));

        assertThat(estimationService.averageServiceTime(queue).duration()).isEqualTo(Duration.ofMinutes(10));
    }

    @Test
    @DisplayName("the person at the front with nobody being attended waits zero")
    void firstInLineWithIdleStationWaitsNothing() {
        assertThat(estimationService.estimateWait(queue, 0, 0, Duration.ofMinutes(5))).isZero();
    }

    @Test
    @DisplayName("counts the customer occupying the station ahead of the queue")
    void countsCustomerBeingAttended() {
        assertThat(estimationService.estimateWait(queue, 0, 1, Duration.ofMinutes(5)))
                .isEqualTo(Duration.ofMinutes(5));
        assertThat(estimationService.estimateWait(queue, 2, 1, Duration.ofMinutes(5)))
                .isEqualTo(Duration.ofMinutes(15));
    }

    @Test
    @DisplayName("parallel service stations divide the wait, rounding up")
    void parallelStationsDivideTheWait() {
        queue.setServiceStations(3);

        // 6 people ahead + 1 being attended = 7, over 3 stations = 3 rounds.
        assertThat(estimationService.estimateWait(queue, 6, 1, Duration.ofMinutes(5)))
                .isEqualTo(Duration.ofMinutes(15));
        // 2 people ahead over 3 stations is still a single round.
        assertThat(estimationService.estimateWait(queue, 2, 0, Duration.ofMinutes(5)))
                .isEqualTo(Duration.ofMinutes(5));
    }

    @Test
    @DisplayName("minutes shown to customers are always rounded up")
    void roundsMinutesUp() {
        assertThat(EstimationService.toMinutes(Duration.ofSeconds(61))).isEqualTo(2);
        assertThat(EstimationService.toMinutes(Duration.ofSeconds(60))).isEqualTo(1);
        assertThat(EstimationService.toMinutes(Duration.ZERO)).isZero();
        assertThat(EstimationService.toMinutes(null)).isZero();
    }

    @Test
    @DisplayName("asks the repository for at most the configured number of samples")
    void limitsSampleSize() {
        estimationService = new EstimationService(entryRepository, properties(3));
        when(entryRepository.findRecentServiceTimings(any(), any(Pageable.class)))
                .thenReturn(List.of(served(Duration.ofMinutes(6))));

        estimationService.averageServiceTime(queue);

        verify(entryRepository).findRecentServiceTimings(
                any(), argThat(pageable -> pageable.getPageSize() == 3));
    }

    private static EntryTimings served(Duration serviceTime) {
        Instant start = NOW.minus(serviceTime);
        return new EntryTimings(EntryStatus.SERVED, start.minusSeconds(300), start, start, NOW);
    }

    private static AppProperties properties(int samples) {
        return new AppProperties(
                "http://localhost:3000",
                List.of("http://localhost:3000"),
                new AppProperties.Jwt("secret-that-is-long-enough-for-hs256!!", "q-api", Duration.ofHours(12)),
                new AppProperties.Estimation(samples),
                new AppProperties.Grace(Duration.ofSeconds(10)),
                new AppProperties.Sse(Duration.ofMinutes(30), Duration.ofSeconds(20)),
                new AppProperties.Notifications(new AppProperties.Notifications.Email(false, "no-reply@q.local")),
                new AppProperties.Seed(false));
    }
}
