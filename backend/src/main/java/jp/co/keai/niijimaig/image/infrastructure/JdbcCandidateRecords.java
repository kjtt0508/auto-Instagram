package jp.co.keai.niijimaig.image.infrastructure;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import jp.co.keai.niijimaig.image.application.CandidateImages;
import jp.co.keai.niijimaig.image.domain.ImageCandidate;

/** 成功した画像生成の記録から、候補（1〜候補の数）を辿る */
@Repository
public class JdbcCandidateRecords implements CandidateImages.Records {

	private final JdbcTemplate jdbc;

	public JdbcCandidateRecords(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	@Override
	public List<ImageCandidate> generatedSince(Instant since) {
		return jdbc.query("""
				select g.tenant_id, g.id, p.position, g.requested_at
				  from image_generations g cross join lateral generate_series(1, g.candidate_count) as p(position)
				 where g.outcome = 'SUCCEEDED' and g.requested_at >= ?
				 order by g.requested_at, p.position
				""", (rs, i) -> new ImageCandidate(rs.getObject("tenant_id", UUID.class), rs.getObject("id", UUID.class),
						rs.getInt("position"), rs.getTimestamp("requested_at").toInstant()),
				Timestamp.from(since));
	}
}
