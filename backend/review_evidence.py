"""Local administrator tool for explicit evidence-review integrity records."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
from app.services.review_signatures import read_key,signature
from app.services.requirement_evidence import read_json


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--key-file',required=True,type=Path)
    parser.add_argument('--init-key',action='store_true')
    parser.add_argument('--record',type=Path)
    parser.add_argument('--reviewer')
    parser.add_argument('--reference')
    parser.add_argument('--scope')
    args=parser.parse_args()
    if args.init_key:
        args.key_file.parent.mkdir(parents=True,exist_ok=True)
        fd=os.open(args.key_file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as stream:stream.write(secrets.token_bytes(32))
        print(json.dumps({'key_created':True,'key_file':str(args.key_file)}));return
    if not all((args.record,args.reviewer,args.reference,args.scope)):
        parser.error('Signing requires --record, --reviewer, --reference and --scope')
    record,_=read_json(args.record)
    root=args.record.parent.resolve();artifact=(root/record['artifact']).resolve()
    if not artifact.is_relative_to(root):raise ValueError('Artifact escapes record directory')
    _,artifact_data=read_json(artifact)
    digest=hashlib.sha256(artifact_data).hexdigest()
    if record.get('sha256')!=digest:raise ValueError('Artifact hash does not match; review the discrepancy first')
    record['review']={'status':'QUALIFIED','reviewer':args.reviewer,'evidence_ref':args.reference,'scope':args.scope}
    record['signature']=signature(record,read_key(args.key_file))
    temporary=args.record.with_name(args.record.name+'.review-tmp')
    fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    try:
        with os.fdopen(fd,'w') as stream:json.dump(record,stream,indent=2,allow_nan=False);stream.write('\n')
        os.replace(temporary,args.record)
    finally:
        if temporary.exists():temporary.unlink()
    print(json.dumps({'record_signed':str(args.record),'artifact_sha256':digest,'scope':args.scope}))

if __name__=='__main__':main()
