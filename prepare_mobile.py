"""Create local phone HTTPS certificates; never installs trust or changes networking."""
import argparse
import datetime
import ipaddress
import json
import sys
from pathlib import Path
from local_network import computer_address, local_address

ROOT = Path(__file__).resolve().parent


def wifi_address():
    config = json.loads((ROOT / 'relay.local.json').read_text(encoding='utf-8'))
    return computer_address(config['esp_host'])


def create_certificates(folder, address):
    # Only certificate creation needs this development dependency. The server uses stdlib SSL.
    sys.path.insert(0, str(ROOT / '.tools/mobile-crypto'))
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    ca_path, ca_key_path = folder / 'ca.pem', folder / 'ca.key'
    if ca_path.exists() != ca_key_path.exists():
        raise ValueError('Incomplete local CA files. Restore the matching CA files before continuing.')
    if ca_path.exists():
        ca = x509.load_pem_x509_certificate(ca_path.read_bytes())
        ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password=None)
        if ca.not_valid_after_utc <= now + datetime.timedelta(days=1):
            raise ValueError('Local CA expired. Generate a new local CA and trust it on the phone again.')
    else:
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'ESP Car Phone CA (this computer)')])
        ca = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key())
              .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=5))
              .not_valid_after(now + datetime.timedelta(days=365))
              .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
              .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
              .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False, key_encipherment=False,
                  data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True, encipher_only=None, decipher_only=None), critical=True)
              .sign(ca_key, hashes.SHA256()))
        ca_key_path.write_bytes(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        ca_path.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (folder / 'phone-ca.crt').write_bytes(ca.public_bytes(serialization.Encoding.DER))
    metadata = folder / 'settings.json'
    regenerate = True
    if metadata.exists() and (folder / 'server.crt').exists() and (folder / 'server.key').exists():
        old = json.loads(metadata.read_text(encoding='utf-8'))
        leaf = x509.load_pem_x509_certificate((folder / 'server.crt').read_bytes())
        regenerate = old.get('address') != address or old.get('cert_profile') != 2 or leaf.not_valid_after_utc < now + datetime.timedelta(days=7)
    if regenerate:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'ESP Car Local Phone Controller')])
        sans = [x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]
        if address != '127.0.0.1':
            sans.append(x509.IPAddress(ipaddress.ip_address(address)))
        leaf = (x509.CertificateBuilder().subject_name(name).issuer_name(ca.subject).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=5))
                .not_valid_after(min(now + datetime.timedelta(days=90), ca.not_valid_after_utc))
                .add_extension(x509.SubjectAlternativeName(sans), critical=False)
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
                .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=True,
                    data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=None, decipher_only=None), critical=True)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                .sign(ca_key, hashes.SHA256()))
        (folder / 'server.key').write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        (folder / 'server.crt').write_bytes(leaf.public_bytes(serialization.Encoding.PEM) + ca.public_bytes(serialization.Encoding.PEM))
    metadata.write_text(json.dumps({'address': address, 'cert_profile': 2}, indent=2) + '\n', encoding='utf-8')
    return ca.fingerprint(hashes.SHA256()).hex(':')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--address', help='Optional explicit computer address on the shared Wi-Fi')
    parser.add_argument('--print-address', action='store_true', help='Detect and print only the computer Wi-Fi address')
    args = parser.parse_args()
    try:
        address = local_address(args.address) if args.address else wifi_address()
        if args.print_address:
            print(address)
            return
        fingerprint = create_certificates(ROOT / '.mobile', address)
    except (OSError, ValueError, ImportError) as error:
        raise SystemExit(str(error)) from None
    print(f'Phone certificate setup: http://{address}:8768')
    print(f'Phone controller: https://{address}:8767/phone')
    print(f'Local CA SHA-256: {fingerprint}')
    print('Trust phone-ca.crt on your phone once. No certificate was installed on this computer.')


if __name__ == '__main__':
    main()
