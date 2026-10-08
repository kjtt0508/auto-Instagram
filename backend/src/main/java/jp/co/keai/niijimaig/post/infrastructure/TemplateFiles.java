package jp.co.keai.niijimaig.post.infrastructure;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * テンプレートのファイル（リポジトリの templates/<版>/ をクラスパスの templates/<版>/ に同梱したもの）。
 * 画像化のブラウザに配る。版の外（../ など）は返さない。読んだファイルは覚えておく
 */
final class TemplateFiles {

	private static final Pattern VERSION = Pattern.compile("[A-Za-z0-9._@-]+");
	private static final Pattern PATH = Pattern.compile("[A-Za-z0-9._@-]+(/[A-Za-z0-9._@-]+)*");

	private final Map<String, Optional<byte[]>> cache = new ConcurrentHashMap<>();

	/** 版の中のファイル。版・パスの形が正しくない、または無ければ空 */
	Optional<byte[]> read(String version, String path) {
		if (!VERSION.matcher(version).matches() || !PATH.matcher(path).matches() || path.contains("..")) {
			return Optional.empty();
		}
		return cache.computeIfAbsent(version + "/" + path, key -> load("templates/" + key));
	}

	private Optional<byte[]> load(String resource) {
		try (InputStream in = TemplateFiles.class.getClassLoader().getResourceAsStream(resource)) {
			return in == null ? Optional.empty() : Optional.of(in.readAllBytes());
		} catch (IOException e) {
			return Optional.empty();
		}
	}

	/** ファイルの種類（Content-Type） */
	static String contentType(String path) {
		if (path.endsWith(".html")) {
			return "text/html; charset=utf-8";
		}
		if (path.endsWith(".css")) {
			return "text/css; charset=utf-8";
		}
		if (path.endsWith(".js")) {
			return "text/javascript; charset=utf-8";
		}
		return path.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
	}
}
