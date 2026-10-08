package jp.co.keai.niijimaig.post.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * テンプレートの版のファイル（フォントを含む）のハッシュを固定する（ADR-0010 決定 1・4）。
 * 版は変更しない。変えるときは新しい版のフォルダを作り、その版のハッシュをここに足す。このテストの値は書き換えない。
 */
class TemplateVersionFilesTest {

	private static final Map<String, String> NIIJIMA_1 = Map.of(
			"index.html", "7494261b0e487b106e417f168ecfe1faaaaa791188fb0f0275a0c9f21137ecef",
			"style.css", "40f849ad057039f3dff10a0e904b659f7c28217f22ecf9688e30ec126165f2ca",
			"render.js", "d767a58ff12a2be9990935cdf9364d08224229a04d46555294f7538596e87618",
			"fonts/NotoSansJP-Bold.woff2", "a7fc013ef6deb7a3233b8046a974ab4618f3effba5e6c56cec8478270a3baad7",
			"fonts/NotoSansJP-Black.woff2", "dd06d9f9ad6af828f41921e56992ccfd142831020348e557117ba1752164ae87",
			"fonts/NotoColorEmoji.woff2", "4cc3b6133fcf1b56e537130c1ebe61959848d477f3938d5c0d2717aad371ffbe",
			"fonts/OFL-NotoSansJP.txt", "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2",
			"fonts/OFL-NotoColorEmoji.txt", "ac564676d10054a8445923dfc2dfb13c042d97888bd27c1b6ec6dfe89a9d8d62",
			"fonts/README.txt", "69a00998304829c00adcc0b5935e8b0dace4d5df1f814b921b63b3a11c3008fd");

	@Test
	@DisplayName("NFR-002-04 niijima@1 のファイル（HTML・CSS・描画スクリプト・フォント・ライセンス文）のハッシュは固定されている")
	void niijima1FilesAreUnchanged() throws Exception {
		TemplateFiles files = new TemplateFiles();
		for (Map.Entry<String, String> expected : NIIJIMA_1.entrySet()) {
			byte[] bytes = files.read("niijima@1", expected.getKey()).orElseThrow(() -> new AssertionError("ファイルが無い: " + expected.getKey()));
			String actual = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
			assertThat(actual).as(expected.getKey()).isEqualTo(expected.getValue());
		}
	}

	@Test
	@DisplayName("AC-002-01 画像化のブラウザに配るのは版の中のファイルだけ（../ や別の版・別の場所は返さない）")
	void servesOnlyFilesInsideTheVersion() {
		TemplateFiles files = new TemplateFiles();
		assertThat(files.read("niijima@1", "../niijima@1/index.html")).isEmpty();
		assertThat(files.read("niijima@1", "/index.html")).isEmpty();
		assertThat(files.read("../templates", "niijima@1/index.html")).isEmpty();
		assertThat(files.read("..", "niijima@1/index.html")).isEmpty();
		assertThat(files.read(".", "index.html")).isEmpty();
		assertThat(files.read("niijima@1", "./index.html")).isEmpty();
		assertThat(files.read("niijima@1", "fonts/../index.html")).isEmpty();
		assertThat(files.read("niijima@1", "fonts/./README.txt")).isEmpty();
		assertThat(files.read("niijima@1", "..")).isEmpty();
		assertThat(files.read("niijima@1", "no-such.js")).isEmpty();
		assertThat(files.read("niijima@1", "index.html")).isPresent();
	}
}
