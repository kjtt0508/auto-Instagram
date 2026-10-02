package jp.co.keai.niijimaig.tenant.domain;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TenantRepository {

	Optional<Tenant> find(UUID tenantId);

	List<UUID> allTenantIds();
}
