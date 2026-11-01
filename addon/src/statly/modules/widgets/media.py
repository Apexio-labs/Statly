"""Validation helpers for non-executable widget media assets."""

from __future__ import annotations

import hashlib
import zlib

MEDIA_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/webm": "webm",
}

MAX_WIDGET_MEDIA_FILE_BYTES = 200 * 1024 * 1024
MAX_WIDGET_MEDIA_TOTAL_BYTES = 500 * 1024 * 1024
MAX_PROFILE_WIDGET_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
MAX_WIDGET_MEDIA_PIXELS = 40_000_000
MAX_WIDGET_MEDIA_ASSETS = 12
MAX_WIDGET_MEDIA_ANIMATED_FRAMES = 500
MAX_WIDGET_MEDIA_ANIMATED_PIXELS = 120_000_000


def _png_dimensions(data: bytes) -> tuple[int, int]:
    offset = 8
    width = height = 0
    saw_ihdr = saw_idat = False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError("The PNG image structure is incomplete.")
        chunk_size = int.from_bytes(data[offset : offset + 4], "big")
        chunk_type = data[offset + 4 : offset + 8]
        chunk_end = offset + 8 + chunk_size
        if chunk_end + 4 > len(data):
            raise ValueError("The PNG image structure is invalid.")
        chunk_data = data[offset + 8 : chunk_end]
        expected_crc = int.from_bytes(data[chunk_end : chunk_end + 4], "big")
        if zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF != expected_crc:
            raise ValueError("The PNG image checksum is invalid.")
        if not saw_ihdr:
            if chunk_type != b"IHDR" or chunk_size != 13:
                raise ValueError("The PNG image header is invalid.")
            width = int.from_bytes(chunk_data[:4], "big")
            height = int.from_bytes(chunk_data[4:8], "big")
            saw_ihdr = True
        elif chunk_type == b"IHDR":
            raise ValueError("The PNG image contains a duplicate header.")
        if chunk_type in (b"acTL", b"fcTL", b"fdAT"):
            raise ValueError("Animated PNG files are not supported.")
        if chunk_type == b"IDAT":
            saw_idat = True
        if chunk_type == b"IEND":
            if chunk_size != 0 or not saw_idat or chunk_end + 4 != len(data):
                raise ValueError("The PNG image is incomplete.")
            return width, height
        offset = chunk_end + 4
    raise ValueError("The PNG image is incomplete.")


def _skip_gif_sub_blocks(data: bytes, offset: int) -> int:
    while offset < len(data):
        block_size = data[offset]
        offset += 1
        if block_size == 0:
            return offset
        offset += block_size
        if offset > len(data):
            break
    raise ValueError("The GIF image structure is incomplete.")


def _gif_dimensions_and_frames(data: bytes) -> tuple[int, int, int]:
    if len(data) < 13:
        raise ValueError("The GIF image is incomplete.")
    width = int.from_bytes(data[6:8], "little")
    height = int.from_bytes(data[8:10], "little")
    packed = data[10]
    offset = 13
    if packed & 0x80:
        offset += 3 * (1 << ((packed & 0x07) + 1))
    if offset > len(data):
        raise ValueError("The GIF image structure is incomplete.")

    frame_count = 0
    animation_pixels = 0
    while offset < len(data):
        marker = data[offset]
        offset += 1
        if marker == 0x3B:
            if offset != len(data) or frame_count == 0:
                raise ValueError("The GIF image is incomplete.")
            return width, height, frame_count
        if marker == 0x21:
            if offset >= len(data):
                break
            offset = _skip_gif_sub_blocks(data, offset + 1)
            continue
        if marker != 0x2C or offset + 9 > len(data):
            break
        frame_width = int.from_bytes(data[offset + 4 : offset + 6], "little")
        frame_height = int.from_bytes(data[offset + 6 : offset + 8], "little")
        frame_packed = data[offset + 8]
        offset += 9
        if frame_width == 0 or frame_height == 0:
            raise ValueError("The GIF image frame dimensions are invalid.")
        frame_pixels = frame_width * frame_height
        if frame_pixels > MAX_WIDGET_MEDIA_PIXELS:
            raise ValueError("The GIF image frame exceeds the supported pixel limit.")
        if frame_packed & 0x80:
            offset += 3 * (1 << ((frame_packed & 0x07) + 1))
        if offset >= len(data):
            break
        offset += 1
        offset = _skip_gif_sub_blocks(data, offset)
        frame_count += 1
        animation_pixels += frame_pixels
        if (
            frame_count > MAX_WIDGET_MEDIA_ANIMATED_FRAMES
            or animation_pixels > MAX_WIDGET_MEDIA_ANIMATED_PIXELS
        ):
            raise ValueError("The GIF animation exceeds the supported resource limit.")
    raise ValueError("The GIF image structure is incomplete.")


def _webp_dimensions_and_frames(data: bytes) -> tuple[int, int, int]:
    if (
        len(data) < 26
        or data[:4] != b"RIFF"
        or data[8:12] != b"WEBP"
        or int.from_bytes(data[4:8], "little") != len(data) - 8
    ):
        raise ValueError("The WebP image header or length is invalid.")
    offset = 12
    width = height = frame_count = 0
    has_image_data = False
    is_animated = False
    animation_pixels = 0
    while offset + 8 <= len(data):
        chunk_type = data[offset : offset + 4]
        chunk_size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        start = offset + 8
        end = start + chunk_size
        if end > len(data):
            raise ValueError("The WebP image structure is invalid.")
        chunk = data[start:end]
        if chunk_type == b"VP8X" and len(chunk) >= 10:
            width = 1 + int.from_bytes(chunk[4:7], "little")
            height = 1 + int.from_bytes(chunk[7:10], "little")
            is_animated = bool(chunk[0] & 0x02)
        elif chunk_type == b"VP8 " and len(chunk) >= 10:
            if chunk[3:6] != b"\x9d\x01\x2a":
                raise ValueError("The WebP image frame is invalid.")
            width = int.from_bytes(chunk[6:8], "little") & 0x3FFF
            height = int.from_bytes(chunk[8:10], "little") & 0x3FFF
            has_image_data = True
        elif chunk_type == b"VP8L" and len(chunk) >= 5 and chunk[0] == 0x2F:
            bits = int.from_bytes(chunk[1:5], "little")
            width = (bits & 0x3FFF) + 1
            height = ((bits >> 14) & 0x3FFF) + 1
            has_image_data = True
        elif chunk_type == b"ANMF":
            if len(chunk) < 16:
                raise ValueError("The WebP animation frame is incomplete.")
            frame_width = 1 + int.from_bytes(chunk[6:9], "little")
            frame_height = 1 + int.from_bytes(chunk[9:12], "little")
            frame_pixels = frame_width * frame_height
            if frame_pixels > MAX_WIDGET_MEDIA_PIXELS:
                raise ValueError("The WebP animation frame exceeds the pixel limit.")
            frame_count += 1
            animation_pixels += frame_pixels
            has_image_data = True
            if (
                frame_count > MAX_WIDGET_MEDIA_ANIMATED_FRAMES
                or animation_pixels > MAX_WIDGET_MEDIA_ANIMATED_PIXELS
            ):
                raise ValueError("The WebP animation exceeds the supported resource limit.")
        if chunk_type == b"VP8 " or chunk_type == b"VP8L":
            has_image_data = True
        offset = end + (chunk_size & 1)
    if offset != len(data) or not has_image_data or width <= 0 or height <= 0:
        raise ValueError("The WebP image does not contain a complete supported frame.")
    if (
        frame_count > MAX_WIDGET_MEDIA_ANIMATED_FRAMES
        or animation_pixels > MAX_WIDGET_MEDIA_ANIMATED_PIXELS
        or is_animated != (frame_count > 0)
    ):
        raise ValueError("The WebP animation exceeds the supported resource limit.")
    return width, height, frame_count


def _read_ebml_vint(
    data: bytes,
    offset: int,
    *,
    identifier: bool,
) -> tuple[int, int, bool]:
    if offset >= len(data) or data[offset] == 0:
        raise ValueError("The WebM container structure is invalid.")
    first = data[offset]
    marker = 0x80
    length = 1
    while not first & marker:
        marker >>= 1
        length += 1
    if length > (4 if identifier else 8) or offset + length > len(data):
        raise ValueError("The WebM container structure is invalid.")
    value = first if identifier else first & (marker - 1)
    for index in range(1, length):
        value = (value << 8) | data[offset + index]
    is_unknown_size = not identifier and value == (1 << (7 * length)) - 1
    return value, offset + length, is_unknown_size


def _validate_webm_structure(data: bytes) -> None:
    if not data.startswith(b"\x1a\x45\xdf\xa3"):
        raise ValueError("The WebM container header is invalid.")
    header_size, offset, unknown_header_size = _read_ebml_vint(
        data,
        4,
        identifier=False,
    )
    header_end = offset + header_size
    if unknown_header_size or header_end > min(len(data), 1024):
        raise ValueError("The WebM container header is invalid.")
    has_webm_doc_type = False
    while offset < header_end:
        element_id, offset, _ = _read_ebml_vint(data, offset, identifier=True)
        element_size, offset, unknown_size = _read_ebml_vint(
            data,
            offset,
            identifier=False,
        )
        if unknown_size:
            raise ValueError("The WebM container header is invalid.")
        element_end = offset + element_size
        if element_end > header_end:
            raise ValueError("The WebM container header is invalid.")
        if element_id == 0x4282:
            if has_webm_doc_type:
                raise ValueError("The WebM container header is invalid.")
            has_webm_doc_type = data[offset:element_end] == b"webm"
        offset = element_end
    if not has_webm_doc_type:
        raise ValueError("The video is not a WebM container.")
    segment_id, offset, _ = _read_ebml_vint(data, header_end, identifier=True)
    segment_size, offset, unknown_segment_size = _read_ebml_vint(
        data,
        offset,
        identifier=False,
    )
    if (
        segment_id != 0x18538067
        or offset >= len(data)
        or (not unknown_segment_size and offset + segment_size != len(data))
    ):
        raise ValueError("The WebM video is incomplete.")


def _image_dimensions(data: bytes, media_type: str) -> tuple[int, int]:
    if media_type == "image/png":
        if len(data) < 33:
            raise ValueError("The PNG image is incomplete.")
        return _png_dimensions(data)

    if media_type == "image/gif":
        width, height, frame_count = _gif_dimensions_and_frames(data)
        if (
            frame_count > MAX_WIDGET_MEDIA_ANIMATED_FRAMES
            or width * height * frame_count > MAX_WIDGET_MEDIA_ANIMATED_PIXELS
        ):
            raise ValueError("The GIF animation exceeds the supported resource limit.")
        return width, height

    if media_type == "image/jpeg":
        if not data.startswith(b"\xff\xd8"):
            raise ValueError("The JPEG image header is invalid.")
        frame_markers = {
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        }
        offset = 2
        width = height = 0
        saw_scan = False
        while offset < len(data):
            if data[offset] != 0xFF:
                raise ValueError("The JPEG image structure is invalid.")
            while offset < len(data) and data[offset] == 0xFF:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            if marker == 0xD9:
                if width > 0 and height > 0 and saw_scan and offset == len(data):
                    return width, height
                raise ValueError("The JPEG image is incomplete.")
            if marker == 0xD8 or marker == 0x01 or 0xD0 <= marker <= 0xD7:
                raise ValueError("The JPEG image structure is invalid.")
            if offset + 2 > len(data):
                break
            segment_size = int.from_bytes(data[offset : offset + 2], "big")
            if segment_size < 2 or offset + segment_size > len(data):
                raise ValueError("The JPEG image structure is invalid.")
            segment_end = offset + segment_size
            if marker in frame_markers:
                if segment_size < 7 or width or height:
                    raise ValueError("The JPEG image frame is invalid.")
                height = int.from_bytes(data[offset + 3 : offset + 5], "big")
                width = int.from_bytes(data[offset + 5 : offset + 7], "big")
            if marker != 0xDA:
                offset = segment_end
                continue
            if not width or not height or segment_size < 6:
                raise ValueError("The JPEG image scan is invalid.")
            saw_scan = True
            offset = segment_end
            while offset < len(data):
                if data[offset] != 0xFF:
                    offset += 1
                    continue
                marker_offset = offset
                while offset < len(data) and data[offset] == 0xFF:
                    offset += 1
                if offset >= len(data):
                    break
                scan_marker = data[offset]
                if scan_marker == 0x00 or 0xD0 <= scan_marker <= 0xD7:
                    offset += 1
                    continue
                if scan_marker == 0xD9:
                    offset += 1
                    if offset == len(data):
                        return width, height
                    raise ValueError("The JPEG image has trailing data.")
                offset = marker_offset
                break
        raise ValueError("The JPEG image does not contain a complete supported frame.")

    if media_type == "image/webp":
        width, height, _frame_count = _webp_dimensions_and_frames(data)
        return width, height

    raise ValueError("The image format is not supported.")


def inspect_widget_media(data: bytes) -> tuple[str, str, str]:
    """Return the SHA-256 asset ID, MIME type, and canonical extension."""
    if not data:
        raise ValueError("The widget media file is empty.")
    if len(data) > MAX_WIDGET_MEDIA_FILE_BYTES:
        raise ValueError("The widget media file exceeds the 200 MB size limit.")

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        media_type = "image/png"
    elif data.startswith(b"\xff\xd8\xff"):
        media_type = "image/jpeg"
    elif data.startswith((b"GIF87a", b"GIF89a")):
        media_type = "image/gif"
    elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        media_type = "image/webp"
    elif len(data) >= 16 and data[4:8] == b"ftyp":
        raise ValueError("Videos are converted to WebM before they are stored.")
    elif data.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in data[:1024]:
        media_type = "video/webm"
    else:
        raise ValueError("Unsupported media. Use PNG, JPEG, GIF, WebP, MP4 or WebM.")

    if media_type.startswith("image/"):
        width, height = _image_dimensions(data, media_type)
        if width <= 0 or height <= 0 or width * height > MAX_WIDGET_MEDIA_PIXELS:
            raise ValueError("The image dimensions exceed the supported limit.")
    elif media_type == "video/webm":
        _validate_webm_structure(data)

    extension = MEDIA_TYPES[media_type]
    return hashlib.sha256(data).hexdigest(), media_type, extension


def set_gif_loop(data: bytes, enabled: bool) -> bytes:
    """Set or clear the standard GIF infinite-loop application extension."""
    if type(enabled) is not bool:
        raise ValueError("The GIF loop option must be a boolean.")
    inspect_widget_media(data)
    if not data.startswith((b"GIF87a", b"GIF89a")):
        raise ValueError("The GIF loop option requires a GIF image.")

    packed = data[10]
    offset = 13
    if packed & 0x80:
        offset += 3 * (1 << ((packed & 0x07) + 1))
    output = bytearray(data[:offset])
    loop_extension = b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"
    inserted = False

    while offset < len(data):
        marker_offset = offset
        marker = data[offset]
        if marker == 0x2C:
            if enabled and not inserted:
                output.extend(loop_extension)
                inserted = True
            if offset + 10 > len(data):
                raise ValueError("The GIF image structure is incomplete.")
            image_packed = data[offset + 9]
            offset += 10
            if image_packed & 0x80:
                offset += 3 * (1 << ((image_packed & 0x07) + 1))
            if offset >= len(data):
                raise ValueError("The GIF image structure is incomplete.")
            offset = _skip_gif_sub_blocks(data, offset + 1)
            output.extend(data[marker_offset:offset])
            continue
        if marker == 0x3B:
            if enabled and not inserted:
                output.extend(loop_extension)
                inserted = True
            output.extend(data[offset:])
            break
        if marker != 0x21 or offset + 3 > len(data):
            raise ValueError("The GIF extension structure is invalid.")

        label = data[offset + 1]
        block_offset = offset + 2
        extension_end = _skip_gif_sub_blocks(data, block_offset)
        is_loop_extension = (
            label == 0xFF
            and data[block_offset] == 11
            and data[block_offset + 1 : block_offset + 12] in (b"NETSCAPE2.0", b"ANIMEXTS1.0")
        )
        if not is_loop_extension:
            output.extend(data[marker_offset:extension_end])
        offset = extension_end
    result = bytes(output)
    inspect_widget_media(result)
    return result


def validate_widget_media_collection(
    assets: dict[str, bytes],
) -> tuple[int, dict[str, tuple[str, str]]]:
    """Validate an asset mapping and return its total size and MIME metadata."""
    if len(assets) > MAX_WIDGET_MEDIA_ASSETS:
        raise ValueError("A widget package can contain at most 12 media assets.")
    total_size = 0
    metadata: dict[str, tuple[str, str]] = {}
    for asset_id, data in assets.items():
        actual_id, media_type, extension = inspect_widget_media(data)
        if asset_id != actual_id:
            raise ValueError("A widget media asset ID does not match its contents.")
        total_size += len(data)
        if total_size > MAX_WIDGET_MEDIA_TOTAL_BYTES:
            raise ValueError("Widget media exceeds the 40 MiB total size limit.")
        metadata[asset_id] = (media_type, extension)
    return total_size, metadata
