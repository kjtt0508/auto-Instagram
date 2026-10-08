package jp.co.keai.niijimaig.post.infrastructure;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import jp.co.keai.niijimaig.post.domain.BodyContent;
import jp.co.keai.niijimaig.post.domain.Caption;
import jp.co.keai.niijimaig.post.domain.CaptionFooter;
import jp.co.keai.niijimaig.post.domain.ClosingContent;
import jp.co.keai.niijimaig.post.domain.CoverContent;
import jp.co.keai.niijimaig.post.domain.CoverText;
import jp.co.keai.niijimaig.post.domain.FixedHashtags;
import jp.co.keai.niijimaig.post.domain.GeneratedImage;
import jp.co.keai.niijimaig.post.domain.ImageStyle;
import jp.co.keai.niijimaig.post.domain.MaterialImage;
import jp.co.keai.niijimaig.post.domain.PostRevision;
import jp.co.keai.niijimaig.post.domain.PostStyleSettings;
import jp.co.keai.niijimaig.post.domain.PrCategory;
import jp.co.keai.niijimaig.post.domain.Slide;
import jp.co.keai.niijimaig.post.domain.SlideRole;
import jp.co.keai.niijimaig.post.domain.SlideList;
import jp.co.keai.niijimaig.post.domain.SlideText;

/**
 * テンプレートの投稿の版を記録（revision_templates・post_slides・cover_*・body_*・revision_hashtags）から組み立てる。
 * DB は形だけを検査して保存するので、文字数・強調の重なり・追加のハッシュタグは検査せずに戻す（restore 系。違反は violations() で返る）。
 */
@Component
class JdbcTemplateRevisions {

	private final JdbcTemplate jdbc;

	JdbcTemplateRevisions(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	PostRevision read(UUID revisionId, UUID tenantId, Caption caption, PrCategory prCategory) {
		String version = jdbc.queryForObject("select template_version from revision_templates where revision_id = ?", String.class, revisionId);
		PostStyleSettings settings = settings(revisionId, tenantId);
		// 行を読み切ってから各スライドの中身を読む（読みながら次の問い合わせをすると接続を余分に使う）
		List<SlideRow> rows = jdbc.query("select id, role from post_slides where revision_id = ? order by position",
				(rs, i) -> new SlideRow(rs.getObject("id", UUID.class), rs.getString("role")), revisionId);
		List<Slide> slides = rows.stream().map(row -> slide(row.id(), row.role())).toList();
		List<String> hashtags = jdbc.queryForList("select hashtag from revision_hashtags where revision_id = ? order by position",
				String.class, revisionId);
		return PostRevision.restoreSlides(caption, prCategory, SlideList.restore(slides), version, settings, hashtags);
	}

	private PostStyleSettings settings(UUID revisionId, UUID tenantId) {
		return jdbc.queryForObject("""
				select s.id, s.version, s.band_text, s.cover_targets, s.closing_message, s.account_introduction, s.caption_footer,
				       s.fixed_hashtags, l.storage_path as logo
				  from revision_templates t join post_style_settings s on s.id = t.style_settings_id
				  left join post_style_logos l on l.style_settings_id = s.id
				 where t.revision_id = ?
				""", (rs, i) -> settingsOf(rs, tenantId), revisionId);
	}

	private PostStyleSettings settingsOf(ResultSet rs, UUID tenantId) throws SQLException {
		return new PostStyleSettings(tenantId, rs.getInt("version"), rs.getString("band_text"), strings(rs, "cover_targets"),
				rs.getString("closing_message"), rs.getString("account_introduction"), new CaptionFooter(rs.getString("caption_footer")),
				new FixedHashtags(strings(rs, "fixed_hashtags")), Optional.ofNullable(rs.getString("logo")));
	}

	private static List<String> strings(ResultSet rs, String column) throws SQLException {
		return List.of((String[]) rs.getArray(column).getArray());
	}

	private Slide slide(UUID slideId, String role) {
		// 知らない役割は例外（valueOf）。黙って最後のスライドとして扱わない
		return switch (SlideRole.valueOf(role)) {
			case COVER -> new Slide(cover(slideId));
			case BODY -> new Slide(body(slideId));
			case CLOSING -> new Slide(ClosingContent.empty());
		};
	}

	private CoverContent cover(UUID slideId) {
		return jdbc.queryForObject("""
				select c.target, c.keyword, c.annotation, c.closing_words, c.accent, b.id as photo_id, b.storage_path
				  from cover_slides c left join cover_backgrounds cb on cb.slide_id = c.slide_id
				  left join background_photos b on b.id = cb.background_photo_id
				 where c.slide_id = ?
				""", (rs, i) -> new CoverContent(CoverText.restore(new CoverText.Parts(rs.getString("target"), rs.getString("keyword"),
						rs.getString("annotation"), rs.getString("closing_words"), rs.getString("accent"))), background(rs)), slideId);
	}

	private static Optional<CoverContent.Background> background(ResultSet rs) throws SQLException {
		UUID photoId = rs.getObject("photo_id", UUID.class);
		return photoId == null ? Optional.empty() : Optional.of(new CoverContent.Background(photoId, rs.getString("storage_path")));
	}

	private BodyContent body(UUID slideId) {
		BodyRow row = jdbc.queryForObject("select heading, description from body_slides where slide_id = ?",
				(rs, i) -> new BodyRow(rs.getString("heading"), rs.getString("description")), slideId);
		return new BodyContent(SlideText.restore(row.heading(), row.description(), emphases(slideId, row.description())), material(slideId));
	}

	private record SlideRow(UUID id, String role) {
	}

	private record BodyRow(String heading, String description) {
	}

	/** 強調する語（開始位置・長さはコードポイント）を、説明文から切り出した語にする */
	private List<String> emphases(UUID slideId, String description) {
		List<String> words = new ArrayList<>();
		jdbc.query("select start_cp, length_cp from body_emphases where slide_id = ? order by seq", rs -> {
			int start = description.offsetByCodePoints(0, rs.getInt("start_cp"));
			words.add(description.substring(start, description.offsetByCodePoints(start, rs.getInt("length_cp"))));
		}, slideId);
		return words;
	}

	private Optional<MaterialImage> material(UUID slideId) {
		return jdbc.query("""
				select m.storage_path, m.width, m.height, a.generation_id, a.candidate_position, g.style
				  from body_materials m left join material_adoptions a on a.slide_id = m.slide_id
				  left join image_generations g on g.id = a.generation_id
				 where m.slide_id = ?
				""", (rs, i) -> new MaterialImage(rs.getString("storage_path"), rs.getInt("width"), rs.getInt("height"), generated(rs)),
				slideId).stream().findFirst();
	}

	private static Optional<GeneratedImage> generated(ResultSet rs) throws SQLException {
		UUID generationId = rs.getObject("generation_id", UUID.class);
		if (generationId == null) {
			return Optional.empty();
		}
		return Optional.of(new GeneratedImage(generationId, rs.getInt("candidate_position"), ImageStyle.valueOf(rs.getString("style"))));
	}
}
