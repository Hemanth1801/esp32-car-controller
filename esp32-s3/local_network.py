"""Local IPv4 validation and route selection shared by launchers and server."""
import ipaddress
import socket

PRIVATE_NETWORKS = tuple(ipaddress.ip_network(value) for value in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))


def local_address(value):
    address = ipaddress.IPv4Address(value)
    if not any(address in network for network in PRIVATE_NETWORKS):
        raise ValueError('Use this computer\'s private IPv4 address on the shared Wi-Fi.')
    return str(address)


def computer_address(esp_host):
    esp_host = local_address(esp_host)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        route.connect((esp_host, 80))  # Select a route; no packet is transmitted.
        address = local_address(route.getsockname()[0])
    if address == esp_host:
        raise ValueError('The phone address must belong to this computer, not the ESP.')
    return address
