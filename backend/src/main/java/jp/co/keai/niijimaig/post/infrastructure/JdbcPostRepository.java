package jp.co.keai.niijimaig.post.infrastructure;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import jp.co.keai.niijimaig.post.domain.Caption;
import jp.co.keai.niijimaig.post.domain.FailureReason;
import jp.co.keai.niijimaig.post.domain.GeneratedImage;
import jp.co.keai.niijimaig.post.domain.ImageStyle;
import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostEvent;
import jp.co.keai.niijimaig.post.domain.PostFormat;
import jp.co.keai.niijimaig.post.domain.PostMedia;
import jp.co.keai.niijimaig.post.domain.PostMediaList;
import jp.co.keai.niijimaig.post.domain.PostRepository;
import jp.co.keai.niijimaig.post.domain.PostStatus;
import jp.co.keai.niijimaig.post.domain.PrCategory;
import jp.co.keai.niijimaig.post.domain.PublishResult;
import jp.co.keai.niijimaig.post.domain.ScheduledAt;

/** 投稿の記録（post_current ビューから組み立て、出来事は追記する）。オブジェクトとテーブルの変換はここだけで行う */
@Repository
public class JdbcPostRepository implements PostRepository {

	private static final String FIND_FOR_PUBLISHING = """
			select pc.post_id, pc.tenant_id, pc.status, pc.scheduled_at,
			       r.id as revision_id, r.format, r.caption, r.pr_category
			  from post_current pc
			  join post_revisions r on r.id = pc.approved_revision_id
			 where pc.post_id = ? and pc.scheduled_at is not null
			""";

	private final JdbcTemplate jdbc;
	private final TransactionTemplate tx;

	public JdbcPostRepository(JdbcTemplate jdbc, TransactionTemplate tx) {
		this.jdbc = jdbc;
		this.tx = tx;
	}

	@Override
	public Optional<Post> findForPublishing(UUID postId) {
		return jdbc.query(FIND_FOR_PUBLISHING, (rs, i) -> toPost(rs), postId).stream().findFirst();
	}

	private Post toPost(ResultSet rs) throws SQLException {
		UUID revisionId = rs.getObject("revision_id", UUID.class);
		Post.ApprovedContent content = new Post.ApprovedContent(revisionId,
				PostFormat.valueOf(rs.getString("format")), new Caption(rs.getString("caption")),
				PrCategory.valueOf(rs.getString("pr_category")), approvedMedia(revisionId));
		return new Post(new Post.Identity(rs.getObject("post_id", UUID.class), rs.getObject("tenant_id", UUID.class)),
				PostStatus.valueOf(rs.getString("status")), content,
				ScheduledAt.restore(rs.getTimestamp("scheduled_at").toInstant()));
	}

	@Override
	public PostMediaList preparedMedia(UUID revisionId) {
		return media("publish_media", revisionId);
	}

	/** 承認された版の投稿画像。生成画像の由来つきで読む（post_media_origin。REQ-005 設計 5章） */
	private PostMediaList approvedMedia(UUID revisionId) {
		List<PostMedia> media = jdbc.query("""
				select position, storage_path, width, height, byte_size, generation_id, candidate_position, style
				  from post_media_origin where revision_id = ? order by position
				""", (rs, i) -> new PostMedia(rs.getInt("position"), rs.getString("storage_path"), rs.getInt("width"),
						rs.getInt("height"), rs.getLong("byte_size"), generatedOf(rs)),
				revisionId);
		return new PostMediaList(media);
	}

	private Optional<GeneratedImage> generatedOf(ResultSet rs) throws SQLException {
		UUID generationId = rs.getObject("generation_id", UUID.class);
		if (generationId == null) {
			return Optional.empty();
		}
		return Optional.of(new GeneratedImage(generationId, rs.getInt("candidate_position"),
				ImageStyle.valueOf(rs.getString("style"))));
	}

	private PostMediaList media(String table, UUID revisionId) {
		List<PostMedia> media = jdbc.query("select position, storage_path, width, height, byte_size from " + table
				+ " where revision_id = ? order by position",
				(rs, i) -> new PostMedia(rs.getInt("position"), rs.getString("storage_path"), rs.getInt("width"),
						rs.getInt("height"), rs.getLong("byte_size")),
				revisionId);
		return new PostMediaList(media);
	}

	@Override
	public void recordPreparedMedia(UUID revisionId, PostMedia prepared) {
		jdbc.update("""
				insert into publish_media (revision_id, position, storage_path, width, height, byte_size)
				values (?, ?, ?, ?, ?, ?) on conflict (revision_id, position) do nothing
				""", revisionId, prepared.position(), prepared.storagePath(), prepared.width(), prepared.height(),
				prepared.bytes());
	}

	@Override
	public void record(Post post, PostEvent event) {
		insertEvent(post, event);
	}

	@Override
	public void recordFailure(Post post, PostEvent failedEvent, FailureReason reason) {
		tx.executeWithoutResult(status -> {
			long eventId = insertEvent(post, failedEvent);
			jdbc.update("insert into post_failures (post_id, event_id, failure_kind, message) values (?, ?, ?, ?)",
					post.id(), eventId, reason.kind().name(), reason.message());
		});
	}

	@Override
	public void recordPublished(Post post, PostEvent publishedEvent, PublishResult result) {
		tx.executeWithoutResult(status -> {
			jdbc.update("insert into post_publications (post_id, ig_media_id, permalink, published_at) values (?, ?, ?, ?)",
					post.id(), result.igMediaId(), result.permalink(), Timestamp.from(result.publishedAt()));
			insertEvent(post, publishedEvent);
		});
	}

	/** 定期処理による出来事なので actor は無い（NULL）。公開系の出来事には承認された版を残す */
	private long insertEvent(Post post, PostEvent event) {
		return jdbc.queryForObject("""
				insert into post_events (post_id, event_type, from_status, to_status, revision_id, note)
				values (?, ?, ?, ?, ?, nullif(?, '')) returning id
				""", Long.class, post.id(), event.kind().name(), event.from().name(), event.to().name(),
				post.approvedRevisionId(), event.note());
	}
}
