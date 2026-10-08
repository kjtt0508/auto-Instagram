package jp.co.keai.niijimaig.support;

import java.io.IOException;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

/**
 * テストが使う chromium だけを入れる。画像化のコードは自動ダウンロードを止めている（PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD）ので、
 * 全ブラウザ（chromium・firefox・webkit）を落とさずに済むよう、ここで chromium だけを入れる。入っていれば何もダウンロードしない。
 * CLI は終了時に System.exit するので、別の JVM で動かす。
 */
public final class ChromiumInstaller {

	private static boolean done;

	private ChromiumInstaller() {
	}

	public static synchronized void ensureInstalled() {
		if (done) {
			return;
		}
		try {
			Path java = Path.of(System.getProperty("java.home"), "bin", "java");
			Process process = new ProcessBuilder(java.toString(), "-cp", System.getProperty("java.class.path"),
					"com.microsoft.playwright.CLI", "install", "chromium").redirectErrorStream(true)
					.redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
			if (!process.waitFor(10, TimeUnit.MINUTES) || process.exitValue() != 0) {
				process.destroyForcibly();
				throw new IllegalStateException("chromium を入れられませんでした");
			}
			done = true;
		} catch (IOException e) {
			throw new IllegalStateException("chromium を入れられませんでした", e);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("中断されました", e);
		}
	}
}
