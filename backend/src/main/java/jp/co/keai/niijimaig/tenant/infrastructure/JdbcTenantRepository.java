package jp.co.keai.niijimaig.tenant.infrastructure;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import jp.co.keai.niijimaig.post.domain.PublishGrace;
import jp.co.keai.niijimaig.tenant.domain.Tenant;
import jp.co.keai.niijimaig.tenant.domain.TenantRepository;

/** 団体と、その最新の設定（tenant_settings_current） */
@Repository
public class JdbcTenantRepository implements TenantRepository {

	private final JdbcTemplate jdbc;

	public JdbcTenantRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	@Override
	public Optional<Tenant> find(UUID tenantId) {
		return jdbc.query("select tenant_id, publish_grace_minutes, pr_label from tenant_settings_current where tenant_id = ?",
				(rs, i) -> new Tenant(rs.getObject("tenant_id", UUID.class),
						PublishGrace.ofMinutes(rs.getInt("publish_grace_minutes")), rs.getString("pr_label")),
				tenantId).stream().findFirst();
	}

	@Override
	public List<UUID> allTenantIds() {
		return jdbc.queryForList("select id from tenants order by created_at", UUID.class);
	}
}
