package jp.co.keai.niijimaig.tenant.domain;

import java.util.UUID;

import jp.co.keai.niijimaig.post.domain.PublishGrace;

/** 団体: このシステムを使う単位（当面は新島infoだけ）。公開猶予・PR表記などの設定（最新の版）を返す */
public final class Tenant {

	private final UUID id;
	private final PublishGrace publishGrace;
	private final String prLabel;

	public Tenant(UUID id, PublishGrace publishGrace, String prLabel) {
		if (id == null || publishGrace == null || prLabel == null || prLabel.isEmpty()) {
			throw new IllegalArgumentException("団体ID・公開猶予・PR表記は必須");
		}
		this.id = id;
		this.publishGrace = publishGrace;
		this.prLabel = prLabel;
	}

	public UUID id() {
		return id;
	}

	public PublishGrace publishGrace() {
		return publishGrace;
	}

	public String prLabel() {
		return prLabel;
	}
}
