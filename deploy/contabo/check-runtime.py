# Run locally after building Dockerfile.apiserver; resources are isolated and cleaned up.
import argparse, json, os, pathlib, subprocess, tempfile, time, urllib.request, urllib.error

parser=argparse.ArgumentParser(description="Test the built API/worker image against an isolated fake queue and local Caddy. No production credentials are used.")
parser.add_argument("--image", default="repofinisher:contabo-check")
image=parser.parse_args().image

prefix = 'contabo-smoke-' + str(os.getpid())
network = prefix + '-net'
containers = []
cli = ['docker', '--host=unix:///var/run/docker.sock']
command_env = dict(os.environ)
for key in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']:
    command_env.pop(key, None)

def docker(*args, check=True):
    result = subprocess.run(cli + list(args), env=command_env, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError('Docker operation failed: ' + result.stderr[-1200:])
    return result

def logs(name):
    result=docker('logs',name)
    return result.stdout+result.stderr

def start(name, image, command=(), options=()):
    full = prefix + '-' + name
    docker('run','--detach','--name',full,'--network',network,*options,image,*command)
    containers.append(full)
    return full

def published_port(name, port):
    return int(docker("port", name, str(port)).stdout.strip().rsplit(":", 1)[1])

def request(port, path, headers=None, method='GET'):
    req = urllib.request.Request('http://127.0.0.1:' + str(port) + path, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, {key.lower():value for key,value in response.headers.items()}, response.read()
    except urllib.error.HTTPError as error:
        return error.code, {key.lower():value for key,value in error.headers.items()}, error.read()

def wait_for(predicate, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if predicate(): return
        except (OSError, RuntimeError): pass
        time.sleep(.2)
    raise AssertionError('Condition did not become true before timeout')

health_file = '/tmp/repofinisher-worker-heartbeat'
health_check = "const fs=require('node:fs');try{const t=Number(fs.readFileSync('" + health_file + "','utf8'));if(!Number.isFinite(t)||Date.now()-t>60000)process.exit(1)}catch{process.exit(1)}"

with tempfile.TemporaryDirectory(prefix=prefix) as directory:
    directory = pathlib.Path(directory)
    (directory/'mock.cjs').write_text("""const http=require('node:http');let failing=true;http.createServer((q,s)=>{s.setHeader('content-type','application/json');if(q.url==='/recover'){failing=false;s.end('{}');return}if(q.url==='/fail'){failing=true;s.end('{}');return}if(failing){s.statusCode=503;s.end(JSON.stringify({message:'fixture database unavailable'}));return}s.end('[]')}).listen(8082,'0.0.0.0');""")
    (directory/'Caddyfile').write_text(':8080 {\n reverse_proxy api:8080\n}\n')
    docker('network','create',network)
    try:
        fixture = start('mock','node:22-slim',('node','/fixture/mock.cjs'),('--network-alias','mock','--mount','type=bind,src='+str(directory)+',dst=/fixture,readonly','--publish','127.0.0.1::8082'))
        common = ('--read-only','--tmpfs','/tmp:rw,nosuid,size=256m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--init','--env','NODE_ENV=production','--env','REPOFINISHER_WORKER_MODE=persistent','--env','SUPABASE_URL=http://mock:8082','--env','SUPABASE_SECRET_KEY=fixture-only-key')
        api = start('api',image,options=(*common,'--network-alias','api','--publish','127.0.0.1::8080'))
        worker = start('worker',image,('node','artifacts/api-server/dist/persistent-worker.mjs'),(*common,'--env','REPOFINISHER_WORKER_POLL_MS=100','--env','REPOFINISHER_WORKER_HEALTH_FILE='+health_file))
        caddy = start('caddy','caddy:2.11.7-alpine',options=('--publish','127.0.0.1::8080','--mount','type=bind,src='+str(directory/'Caddyfile')+',dst=/etc/caddy/Caddyfile,readonly','--env','NO_PROXY=api,mock,localhost,127.0.0.1'))
        api_port=published_port(api,8080)
        caddy_port=published_port(caddy,8080)
        mock_port=published_port(fixture,8082)
        wait_for(lambda: request(api_port,'/api/healthz')[0] == 200)
        assert docker('inspect','--format','{{.Config.User}}',api).stdout.strip() == 'node'
        assert docker('inspect','--format','{{.HostConfig.ReadonlyRootfs}}',api).stdout.strip() == 'true'
        status, headers, body = request(api_port,'/api/preferences/ai-status',{'Origin':'https://portfolio.donmatthews.live'})
        assert status == 401 and json.loads(body)['error']
        assert headers.get('access-control-allow-origin') == 'https://portfolio.donmatthews.live'
        assert 'Retry-After' in headers.get('access-control-expose-headers','')
        _, denied, _ = request(api_port,'/api/healthz',{'Origin':'https://attacker.example'})
        assert 'access-control-allow-origin' not in denied
        wait_for(lambda: request(caddy_port,'/api/healthz')[0] == 200)
        _, first, _ = request(caddy_port,'/api/healthz',{'X-Forwarded-For':'198.51.100.1'})
        _, second, _ = request(caddy_port,'/api/healthz',{'X-Forwarded-For':'203.0.113.2'})
        import re
        remaining = lambda h: int(re.search(r'remaining=([0-9]+)',h['ratelimit'],re.I).group(1))
        assert remaining(first) - remaining(second) == 1, 'Spoofed IP changed rate-limit bucket'
        wait_for(lambda: 'persistent_worker_poll_failed' in logs(worker))
        assert docker('exec',worker,'node','-e',health_check,check=False).returncode != 0, 'Broken queue was incorrectly healthy'
        request(mock_port,'/recover')
        wait_for(lambda: docker('exec',worker,'node','-e',health_check,check=False).returncode == 0)
        request(mock_port,'/fail')
        time.sleep(.5)
        docker('exec',worker,'node','-e',"require('node:fs').writeFileSync('"+health_file+"',String(Date.now()-61000))")
        time.sleep(11)
        assert docker('exec',worker,'node','-e',health_check,check=False).returncode != 0, 'Failure still refreshed readiness'
        request(mock_port,'/recover')
        wait_for(lambda: docker('exec',worker,'node','-e',health_check,check=False).returncode == 0)
        docker('stop','--time','10',worker)
        assert docker('inspect','--format','{{.State.ExitCode}}',worker).stdout.strip() == '0'
        print(json.dumps({'apiHealth':200,'protectedStatus':401,'nonRootReadOnly':True,'corsAndRetryHeaders':True,'caddyRejectsForwardedIpSpoofing':True,'workerQueueReadinessAndRecovery':True,'workerGracefulShutdown':True}))
    finally:
        for name in reversed(containers): docker('rm','--force',name,check=False)
        docker('network','rm',network,check=False)
