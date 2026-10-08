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
import jp.co.keai.niijimaig.post.domain.PostRevision;
import jp.co.keai.niijimaig.post.domain.PostStatus;
import jp.co.keai.niijimaig.post.domain.PrCategory;
import jp.co.keai.niijimaig.post.domain.PublishResult;
import jp.co.keai.niijimaig.post.domain.ScheduledAt;

/** 投稿の記録（post_current ビューから組み立て、出来事は追記する）。オブジェクトとテーブルの変換はここだけで行う */
@Repository
public class JdbcPostRepository implements PostRepository {

	private static final String FIND_FOR_PUBLISHING = """
			select pc.post_id, pc.tenant_id, pc.status, pc.scheduled_at,
			       r.id as revision_id, r.format, r.media_source, r.caption, r.pr_category
			  from post_current pc
			  join post_revisions r on r.id = pc.approved_revision_id
			 where pc.post_id = ? and pc.scheduled_at is not null
			""";

	/** 公開用に準備済みの画像。写真の投稿は publish_media、テンプレートの投稿は最新の承認の出来事の template_publish_media */
	private static final String PREPARED_MEDIA = """
			select position, storage_path, width, height, byte_size from publish_media where revision_id = ?
			union all
			select t.position, t.storage_path, t.width, t.height, t.byte_size from template_publish_media t
			 where t.revision_id = ? and t.approval_event_id = (
			       select max(e.id) from post_events e join post_revisions r on r.post_id = e.post_id
			        where r.id = ? and e.event_type = 'APPROVED')
			order by position
			""";

	private final JdbcTemplate jdbc;
	private final TransactionTemplate tx;
	private final JdbcTemplateRevisions templateRevisions;

	public JdbcPostRepository(JdbcTemplate jdbc, TransactionTemplate tx, JdbcTemplateRevisions templateRevisions) {
		this.jdbc = jdbc;
		this.tx = tx;
		this.templateRevisions = templateRevisions;
	}

	@Override
	public Optional<Post> findForPublishing(UUID postId) {
		return jdbc.query(FIND_FOR_PUBLISHING, (rs, i) -> toPost(rs), postId).stream().findFirst();
	}

	private Post toPost(ResultSet rs) throws SQLException {
		UUID revisionId = rs.getObject("revision_id", UUID.class);
		UUID tenantId = rs.getObject("tenant_id", UUID.class);
		Post.ApprovedContent content = new Post.ApprovedContent(revisionId, PostFormat.valueOf(rs.getString("format")),
				revisionOf(rs, revisionId, tenantId));
		return new Post(new Post.Identity(rs.getObject("post_id", UUID.class), tenantId),
				PostStatus.valueOf(rs.getString("status")), content,
				ScheduledAt.restore(rs.getTimestamp("scheduled_at").toInstant()));
	}

	/** 写真の投稿（UPLOAD）は投稿画像一覧、テンプレートの投稿（TEMPLATE）はスライドなど。どちらの版かは記録（media_source）で決まる */
	private PostRevision revisionOf(ResultSet rs, UUID revisionId, UUID tenantId) throws SQLException {
		Caption caption = new Caption(rs.getString("caption"));
		PrCategory prCategory = PrCategory.valueOf(rs.getString("pr_category"));
		if ("TEMPLATE".equals(rs.getString("media_source"))) {
			return templateRevisions.read(revisionId, tenantId, caption, prCategory);
		}
		return PostRevision.ofPhotos(caption, prCategory, approvedMedia(revisionId));
	}

	@Override
	public PostMediaList preparedMedia(UUID revisionId) {
		List<PostMedia> media = jdbc.query(PREPARED_MEDIA,
				(rs, i) -> new PostMedia(rs.getInt("position"), rs.getString("storage_path"), rs.getInt("width"),
						rs.getInt("height"), rs.getLong("byte_size")),
				revisionId, revisionId, revisionId);
		return new PostMediaList(media);
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
