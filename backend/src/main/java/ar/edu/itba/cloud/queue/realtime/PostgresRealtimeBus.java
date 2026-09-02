package ar.edu.itba.cloud.queue.realtime;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;

/**
 * Multi-instance transport built on PostgreSQL's LISTEN/NOTIFY.
 *
 * <p>Runs inside the caller's transaction on purpose. PostgreSQL holds a {@code NOTIFY} until the
 * transaction commits and discards it on rollback, so the rule "never announce a change that did not
 * stick" stops being something the application has to remember and becomes something the database
 * enforces. Identical notifications raised more than once in a transaction are also collapsed into
 * one delivery, which is exactly right here: every listener rebuilds the whole board anyway.
 *
 * <p>The payload is only the queue id. Listeners re-read current state from the database rather than
 * trusting the message, so a duplicated or out-of-order notification can never corrupt anything.
 *
 * <p>{@code pg_notify} is used instead of the {@code NOTIFY} statement because the channel and
 * payload can then be bound as parameters rather than concatenated into SQL.
 */
public class PostgresRealtimeBus implements RealtimeBus {

    private static final ResultSetExtractor<Void> DISCARD = resultSet -> null;

    private final JdbcTemplate jdbcTemplate;
    private final String channel;

    public PostgresRealtimeBus(JdbcTemplate jdbcTemplate, String channel) {
        this.jdbcTemplate = jdbcTemplate;
        this.channel = channel;
    }

    @Override
    public void publish(UUID queueId) {
        jdbcTemplate.query("select pg_notify(?, ?)", DISCARD, channel, queueId.toString());
    }
}
