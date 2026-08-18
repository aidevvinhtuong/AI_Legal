"""
EC-01…EC-06 — validate marker và payload gửi FPT, chạy ở server.

Bộ này bám đúng bảng ca kiểm thử của `docs/requirements-alignment/
07-econtract-integration.md` mục 3. Điểm cần giữ: mã lỗi trả ra phải là **mã
của FPT**, không phải mã tự chế — để thông báo cho người dùng giống nhau dù lỗi
bị chặn ở FE, ở BE, hay tận bên FPT.
"""

from __future__ import annotations

from app.services.econtract.payload import build_excall_payload, build_parties, redact
from app.services.econtract.validation import validate_markers, validate_signers


def _marker(recipient_id: str, kind: str = "ds", **over) -> dict:
    return {
        "id": f"{kind}_{recipient_id}",
        "type": kind,
        "height": 98,
        "width": 164,
        "paraId": "204F0C17",
        "align": "center",
        **over,
    }


def _recipient(rid: str, role: str, **over) -> dict:
    base = {
        "id": rid,
        "partyId": rid.rsplit("_r_", 1)[0],
        "name": "Nguyễn Văn A",
        "email": "a@sgvn.local",
        "orgName": "Saint-Gobain Vietnam",
        "isMyOrg": rid.startswith("p_001"),
        "partyKind": "organization",
        "ecRole": role,
        "signType": "sign_fca.passcode" if role in ("signer", "clerk") else "review",
        "markerType": "ds",
        "order": 1,
    }
    base.update(over)
    return base


def _valid_flow() -> list[dict]:
    return [
        _recipient("p_001_r_001", "signer", marker=_marker("p_001_r_001")),
        _recipient(
            "p_002_r_001",
            "signer",
            isMyOrg=False,
            orgName="THACO",
            email="b@thaco.vn",
            marker=_marker("p_002_r_001"),
        ),
    ]


def _codes(issues) -> set[str]:
    return {i.code for i in issues}


def test_luong_hop_le_thi_khong_co_loi():
    assert validate_markers(_valid_flow()) == []


def test_ec01_nguoi_xem_xet_co_marker_bi_chan():
    flow = _valid_flow()
    flow.append(
        _recipient("p_001_r_002", "reviewer", signType="review", marker=_marker("p_001_r_002"))
    )
    assert "wrongFieldWithRole" in _codes(validate_markers(flow))


def test_ec02_trung_id_marker_bi_chan():
    """Ràng buộc C-8: id marker duy nhất trong toàn file."""
    flow = _valid_flow()
    flow[1]["marker"] = _marker("p_001_r_001")  # dùng lại id của người thứ nhất
    assert "tooManyMarkerDigitalField" in _codes(validate_markers(flow))


def test_ec03_thieu_orgname_va_email_bi_chan():
    flow = _valid_flow()
    flow[0]["orgName"] = ""
    flow[1]["email"] = "khong-phai-email"
    codes = _codes(validate_markers(flow))
    assert "isNotExistsIndividual" in codes
    assert "isNotExistsRecipientInfo" in codes


def test_ec04_signtype_khong_khop_loai_marker_bi_chan():
    flow = _valid_flow()
    flow[0]["signType"] = "sign_img"  # cần marker `is`, đang gán `ds`
    assert "wrongFieldWithRole" in _codes(validate_markers(flow))


def test_thieu_marker_bi_chan_kem_ten_nguoi():
    flow = _valid_flow()
    flow[1]["marker"] = None
    issues = validate_markers(flow)
    assert "isNotExistsMarkerField" in _codes(issues)
    assert any("Nguyễn Văn A" in i.message for i in issues)


def test_marker_khong_neo_vao_doan_nao_bi_chan():
    """
    Neo là `paraId`. Marker không có neo thì không ghi được vào tài liệu —
    phải chặn ở đây chứ không phải để writer ném lúc Submit.
    """
    flow = _valid_flow()
    flow[0]["marker"] = _marker("p_001_r_001", paraId="")
    assert "isNotExistsMarkerField" in _codes(validate_markers(flow))


def test_chieu_cao_o_ky_phai_duong():
    flow = _valid_flow()
    flow[0]["marker"] = _marker("p_001_r_001", height=0)
    assert "wrongFieldWithRole" in _codes(validate_markers(flow))


def test_van_thu_cung_can_marker():
    flow = [
        _recipient("p_001_r_001", "signer", marker=_marker("p_001_r_001")),
        _recipient("p_001_r_002", "clerk"),
        _recipient(
            "p_002_r_001",
            "signer",
            isMyOrg=False,
            orgName="THACO",
            marker=_marker("p_002_r_001"),
        ),
    ]
    assert "isNotExistsMarkerField" in _codes(validate_markers(flow))


def test_buoc_1_bat_buoc_co_ca_hai_ben():
    only_us = [_recipient("p_001_r_001", "signer")]
    assert "isNotExistsIndividual" in _codes(validate_signers(only_us))


def test_ben_doi_tac_phai_chon_to_chuc_hay_ca_nhan():
    flow = _valid_flow()
    flow[1]["partyKind"] = None
    assert "isNotExistsIndividual" in _codes(validate_signers(flow))


# ─────────────────────────────────────────────────────────────────────────────
# EC-06 — payload
# ─────────────────────────────────────────────────────────────────────────────
def test_ec06_payload_dung_cau_truc_va_thu_tu_ben_mua_truoc():
    payload = build_excall_payload(
        review_code="SGVN.HQP.260001",
        title="Hợp đồng dịch vụ",
        file_name="hd.docx",
        intake={"contractValue": "685.000.000", "hasDiscount": "no"},
        recipients=_valid_flow(),
        file_base64="QkFTRTY0",
        selector="flow_start_test",
        doc_type_code=2,
    )

    assert payload["refId"] == payload["lookup"] == payload["body"]["refId"]
    assert payload["body"]["fileName"].endswith(".docx"), "FPT nhận .docx base64 (D1c)"

    parties = payload["body"]["parties"]
    assert [p["isMyOrg"] for p in parties] == [True, False], "bên mua phải đứng trước"
    assert parties[0]["recipients"][0]["role"] == "signer"
    assert parties[0]["recipients"][0]["signTypes"] == ["sign_fca.passcode"]

    header = {f["id"]: f["value"] for f in payload["body"]["headerFields"]}
    assert header["envNo"] == "SGVN.HQP.260001"
    assert header["envF03"] == "685000000", "giá trị hợp đồng phải là số thuần"
    assert header["envF01"] == "Không - No"


def test_ca_nhan_thi_isorg_false():
    flow = _valid_flow()
    flow[1]["partyKind"] = "individual"
    parties = build_parties(flow)
    assert parties[1]["isOrg"] is False


def test_van_thu_map_sang_role_signer_cua_fpt():
    flow = [
        _recipient("p_001_r_001", "clerk", marker=_marker("p_001_r_001")),
        _recipient("p_001_r_002", "coordinator", signType="review"),
    ]
    recipients = build_parties(flow)[0]["recipients"]
    by_id = {r["recipientId"]: r for r in recipients}
    assert by_id["p_001_r_001"]["role"] == "signer"
    assert by_id["p_001_r_002"]["role"] == "reviewer"
    assert by_id["p_001_r_002"]["signTypes"] == []


def test_khong_ghi_base64_hop_dong_vao_log():
    """Quy ước log: không bao giờ để nội dung hợp đồng lọt ra ngoài."""
    payload = build_excall_payload(
        review_code="X",
        title="t",
        file_name="a.docx",
        intake={},
        recipients=_valid_flow(),
        file_base64="A" * 5000,
        selector="s",
        doc_type_code=2,
    )
    safe = redact(payload)
    assert "A" * 100 not in str(safe)
    assert "5000 ký tự" in safe["body"]["file"]
