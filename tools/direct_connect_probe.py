"""Validate Kunos Remote Telemetry before integrating it into the iPhone app."""

import argparse
import socket
import struct

# Kunos RTCarInfo through gear, including C alignment after the identifier
# and six flags. The remaining wheel and position fields are unused here.
CAR_PREFIX = struct.Struct("<c3xi3f6?2x3f4i5fi")
HANDSHAKE = struct.Struct("<iii")
PORT = 9996


def decode_car(packet):
    if len(packet) < CAR_PREFIX.size:
        raise ValueError("Truncated telemetry packet")
    marker, size, speed, *_ = CAR_PREFIX.unpack_from(packet)
    if marker != b"a" or size != len(packet):
        raise ValueError("Unexpected telemetry packet")
    rpm, _, gear = struct.unpack_from("<ffi", packet, CAR_PREFIX.size - 12)
    return speed, rpm, gear


def sample(host):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.settimeout(3)
        connection.connect((host, PORT))
        connection.send(HANDSHAKE.pack(1, 1, 0))
        reply = connection.recv(2048)
        if len(reply) not in (208, 408, 808):
            raise ValueError(f"Unexpected handshake reply of {len(reply)} bytes")
        connection.send(HANDSHAKE.pack(1, 1, 1))
        try:
            return decode_car(connection.recv(2048))
        finally:
            connection.send(HANDSHAKE.pack(1, 1, 3))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host", nargs="?", default="127.0.0.1")
    args = parser.parse_args()
    try:
        speed, rpm, gear = sample(args.host)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}. Check the PC address and start an AC driving session.\n")
    print(f"{speed:.1f} km/h | {rpm:.0f} RPM | raw gear {gear}")
