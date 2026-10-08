package jp.co.keai.niijimaig.post.infrastructure;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import jp.co.keai.niijimaig.post.application.RenderRecords;
import jp.co.keai.niijimaig.post.domain.PastPostCover;
import jp.co.keai.niijimaig.post.domain.PostMedia;

/** 画像化の記録（template_renders・template_publish_media・approval_past_posts）。書き込みは定期処理用の RPC を通す */
@Repository
class JdbcRenderRecords implements RenderRecords {

	private final JdbcTemplate jdbc;

	JdbcRenderRecords(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	@Override
	public long approvalEvent(UUID postId, UUID approvedRevisionId) {
		return jdbc.query("select id, revision_id from post_events where post_id = ? and event_type = 'APPROVED' order by id desc limit 1",
				(rs, i) -> new ApprovalRow(rs.getLong("id"), rs.getObject("revision_id", UUID.class)), postId).stream().findFirst()
				.filter(row -> approvedRevisionId.equals(row.revisionId())).map(ApprovalRow::id)
				.orElseThrow(() -> new IllegalStateException("承認された版を承認した出来事がありません"));
	}

	private record ApprovalRow(long id, UUID revisionId) {
	}

	@Override
	public List<PastPostCover> pastPosts(long approvalEventId) {
		return jdbc.query("select past_post_id, cover_storage_path from approval_past_posts where approval_event_id = ? order by position",
				(rs, i) -> PastPostCover.restore(rs.getObject("past_post_id", UUID.class), rs.getString("cover_storage_path")),
				approvalEventId);
	}

	@Override
	public Optional<PostMedia> rendered(long approvalEventId, int position) {
		return jdbc.query("select position, storage_path, width, height, byte_size from template_renders where approval_event_id = ? and position = ?",
				(rs, i) -> media(rs.getInt("position"), rs.getString("storage_path"), rs.getInt("width"), rs.getInt("height"), rs.getLong("byte_size")),
				approvalEventId, position).stream().findFirst();
	}

	@Override
	public void recordRender(UUID revisionId, long approvalEventId, PostMedia rendered) {
		jdbc.queryForList("select public.record_template_render(?, ?, ?, ?, ?, ?, ?)", revisionId, approvalEventId, rendered.position(),
				rendered.storagePath(), rendered.width(), rendered.height(), (int) rendered.bytes());
	}

	@Override
	public Optional<PostMedia> publishMedia(UUID revisionId, long approvalEventId, int position) {
		return jdbc.query("""
				select position, storage_path, width, height, byte_size from template_publish_media
				 where revision_id = ? and approval_event_id = ? and position = ?
				""",
				(rs, i) -> media(rs.getInt("position"), rs.getString("storage_path"), rs.getInt("width"), rs.getInt("height"), rs.getLong("byte_size")),
				revisionId, approvalEventId, position).stream().findFirst();
	}

	@Override
	public void recordPublishMedia(UUID revisionId, long approvalEventId, PostMedia published) {
		jdbc.queryForList("select public.record_template_publish_media(?, ?, ?, ?, ?, ?, ?)", revisionId, approvalEventId,
				published.position(), published.storagePath(), published.width(), published.height(), (int) published.bytes());
	}

	private static PostMedia media(int position, String path, int width, int height, long bytes) {
		return new PostMedia(position, path, width, height, bytes);
	}
}
