from app.services.review_signatures import signature,verify

def test_signature_covers_artifact_and_review(tmp_path):
    key=b'x'*32;path=tmp_path/'key';path.write_bytes(key)
    record={'artifact':'result.json','sha256':'a'*64,'review':{'status':'QUALIFIED','reviewer':'fixture'}}
    record['signature']=signature(record,key)
    assert verify(record,path)
    record['review']['reviewer']='changed'
    assert not verify(record,path)

def test_missing_signature_is_not_verified(tmp_path):
    assert verify({},tmp_path/'missing') is False

def test_local_review_cli_does_not_overwrite_key_and_signs_record(tmp_path):
    import subprocess,sys,json,hashlib
    from pathlib import Path
    script=Path(__file__).resolve().parents[1]/'review_evidence.py'
    key=tmp_path/'key'
    subprocess.run([sys.executable,str(script),'--key-file',str(key),'--init-key'],check=True,capture_output=True)
    original=key.read_bytes()
    assert len(original)==32 and key.stat().st_mode & 0o777 == 0o600
    assert subprocess.run([sys.executable,str(script),'--key-file',str(key),'--init-key'],capture_output=True).returncode!=0
    assert key.read_bytes()==original
    artifact=tmp_path/'observation.json';artifact.write_text('{}')
    path=tmp_path/'record.json';path.write_text(json.dumps({'artifact':artifact.name,'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest()}))
    subprocess.run([sys.executable,str(script),'--key-file',str(key),'--record',str(path),'--reviewer','fixture','--reference','test only','--scope','numerical-test'],check=True,capture_output=True)
    assert verify(json.loads(path.read_text()),key)
