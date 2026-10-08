package jp.co.keai.niijimaig.post.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 画像化が読み書きする保存先の規則（団体の置き場所の中だけ）。AC-002-23 */
class OwnedStoragePathTest {

	private final UUID tenant = UUID.randomUUID();
	private final UUID other = UUID.randomUUID();

	@Test
	@DisplayName("AC-002-23 団体の posts/・backgrounds/・style/・renders/ の中の保存先は受け付ける")
	void acceptsOwnFolders() {
		for (String folder : new String[] { "posts/a1.jpg", "backgrounds/b-2_x.jpg", "style/logo.png", "renders/12/3.jpg" }) {
			assertThat(OwnedStoragePath.isOwnedBy(tenant, tenant + "/" + folder)).as(folder).isTrue();
		}
	}

	@Test
	@DisplayName("AC-002-23 他の団体のパス・.. や // ・? や # を含む参照・許した置き場所でない参照は拒否する")
	void rejectsOthers() {
		String[] rejected = {
				other + "/posts/a.jpg",
				tenant + "/posts/../" + other + "/posts/a.jpg",
				tenant + "/posts//a.jpg",
				tenant + "/posts/a.jpg?download=1",
				tenant + "/posts/a.jpg#x",
				tenant + "/secrets/a.jpg",
				tenant + "/posts/",
				tenant + "/a.jpg",
				"posts/a.jpg",
				"",
		};
		for (String path : rejected) {
			assertThat(OwnedStoragePath.isOwnedBy(tenant, path)).as(path).isFalse();
			assertThatThrownBy(() -> OwnedStoragePath.require(tenant, path)).isInstanceOf(RenderFailedException.class);
		}
		assertThat(OwnedStoragePath.isOwnedBy(tenant, null)).isFalse();
	}

	@Test
	@DisplayName("AC-002-23 画像化は、他の団体のパス・.. を含む参照を Storage から読まずに画像化の失敗にする")
	void renderImagesDoNotReadRejectedRefs() {
		AtomicInteger reads = new AtomicInteger();
		RenderStorage storage = new RenderStorage() {
			@Override
			public Optional<byte[]> read(UUID tenantId, String privatePath) {
				reads.incrementAndGet();
				return Optional.of(new byte[] { 1 });
			}

			@Override
			public void save(UUID tenantId, String privatePath, byte[] jpeg) {
			}
		};
		RenderImages images = new RenderImages(storage, tenant);

		assertThatThrownBy(() -> images.dataUrls(java.util.List.of(other + "/posts/a.jpg"))).isInstanceOf(RenderFailedException.class);
		assertThatThrownBy(() -> images.dataUrls(java.util.List.of(tenant + "/posts/../x/a.jpg"))).isInstanceOf(RenderFailedException.class);
		assertThat(reads).hasValue(0);
		assertThat(images.dataUrls(java.util.List.of(tenant + "/posts/a.jpg")).get(tenant + "/posts/a.jpg").toString()).startsWith("data:image/jpeg;base64,");
	}
}
