package jp.co.keai.niijimaig.post.infrastructure;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import jp.co.keai.niijimaig.post.application.PublishingLog;

@Repository
public class JdbcPublishingLog implements PublishingLog {

	private final JdbcTemplate jdbc;

	public JdbcPublishingLog(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	@Override
	public void recordContainer(UUID postId, long attemptId, ContainerKind kind, String containerId) {
		jdbc.update("insert into ig_containers (post_id, job_attempt_id, kind, container_id) values (?, ?, ?, ?)",
				postId, attemptId, kind.name(), containerId);
	}

	@Override
	public Optional<String> lastParentContainer(UUID postId) {
		return jdbc.queryForList("""
				select container_id from ig_containers
				 where post_id = ? and kind in ('SINGLE','CAROUSEL') order by id desc limit 1
				""", String.class, postId).stream().findFirst();
	}

	@Override
	public Optional<Instant> publishingStartedAt(UUID postId) {
		return jdbc.queryForList("""
				select occurred_at from post_events
				 where post_id = ? and event_type = 'PUBLISH_STARTED' order by id desc limit 1
				""", Timestamp.class, postId).stream().findFirst().map(Timestamp::toInstant);
	}
}
