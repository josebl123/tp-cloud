package ar.edu.itba.cloud.queue.config;

import ar.edu.itba.cloud.queue.realtime.LocalRealtimeBus;
import ar.edu.itba.cloud.queue.realtime.PostgresNotificationListener;
import ar.edu.itba.cloud.queue.realtime.PostgresRealtimeBus;
import ar.edu.itba.cloud.queue.realtime.RealtimeBroadcaster;
import ar.edu.itba.cloud.queue.realtime.RealtimeBus;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Selects how queue changes travel between instances.
 *
 * <p>PostgreSQL is the default because that is what production runs: several EC2 instances behind a
 * load balancer, any of which may hold a given customer's stream. Tests opt down to the in-JVM
 * transport so their assertions stay deterministic.
 */
@Configuration
public class RealtimeConfig {

    @Bean
    @ConditionalOnProperty(prefix = "q.realtime", name = "mode", havingValue = "LOCAL")
    public RealtimeBus localRealtimeBus(ApplicationEventPublisher publisher) {
        return new LocalRealtimeBus(publisher);
    }

    @Bean
    @ConditionalOnProperty(prefix = "q.realtime", name = "mode", havingValue = "POSTGRES",
            matchIfMissing = true)
    public RealtimeBus postgresRealtimeBus(JdbcTemplate jdbcTemplate, AppProperties properties) {
        return new PostgresRealtimeBus(jdbcTemplate, properties.realtime().channel());
    }

    @Bean
    @ConditionalOnProperty(prefix = "q.realtime", name = "mode", havingValue = "POSTGRES",
            matchIfMissing = true)
    public PostgresNotificationListener postgresNotificationListener(RealtimeBroadcaster broadcaster,
                                                                     DataSourceProperties dataSource,
                                                                     AppProperties properties) {
        AppProperties.Realtime realtime = properties.realtime();
        return new PostgresNotificationListener(
                broadcaster,
                dataSource.determineUrl(),
                dataSource.determineUsername(),
                dataSource.determinePassword(),
                realtime.channel(),
                realtime.pollTimeout(),
                realtime.reconnectDelay());
    }
}
