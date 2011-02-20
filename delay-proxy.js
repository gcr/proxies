var http = require('http');

// This proxy imposes a 30-second delay on certain sites.
//
// engage with:
// sudo iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-ports 8080 -m owner '!' --uid-owner nobody
// sudo -u nobody node rotating-proxy.js

var al = new (require('./lib/async_lock.js').AsyncLock)(),
    TIMEOUT=1000 * 20,
    TIMED_DOMAINS = ['hackerne.ws', 'reddit', 'iamlights', 'bofh.ntk.net'];

function shouldBeTimed(host) {
  for (var target=0,l=TIMED_DOMAINS.length; target<l; target++) {
    if (host.toLowerCase().indexOf(TIMED_DOMAINS[target]) != -1) {
      return true;
    }
  }
  return false;
}


http.createServer(function(proxiedReq, proxiedRes) {
  // Make the outgoing connection
  console.log("Waiting...");
  function serviceRequest(unlockReal, timeout) {
    console.log("Lock serviced us...");
    setTimeout(function(){
      console.log("Serving request...");
      var locked=true;
      function unlock(){
        if (locked) {
          console.log("Unlocked");
          locked=false;
          unlockReal();
        }
      }
      delete proxiedReq.headers.connection;
      var newClient = http.createClient(80, proxiedReq.headers.host),
          newReq = newClient.request(proxiedReq.method, proxiedReq.url, proxiedReq.headers);

      newClient.addListener('error', function(error) {
          console.log(error);
          console.log(error.stack);
          unlock();
        });
      proxiedReq.connection.setMaxListeners(15);
      proxiedReq.connection.addListener('error', function(error) {
          console.log(error);
          console.log(error.stack);
          unlock();
        });

      newReq.addListener('response', function(newRes) {
          // when the server (the website the client is browsing to) gives us our
          // response

          newRes.addListener('error', function(error) {
              console.log(error);
              console.log(error.stack);
              unlock();
            });
          newRes.addListener('data', function(chunk) {
              proxiedRes.write(chunk, 'binary');
            });
          newRes.addListener('end', function() {
              proxiedRes.end();
              unlock();
            });
          // pass headers on to the client
          proxiedRes.writeHead(newRes.statusCode, newRes.headers);
        });

      newReq.addListener('data', function(chunk) {
          // when the client sends data, pass it through
          proxiedRes.write(chunk, 'binary');
        });

      newReq.addListener('end', function() {
          // when the client ends, go away
          proxiedRes.end();
          unlock();
        });

      newReq.end();
    }, timeout);
  }
  if (shouldBeTimed(proxiedReq.headers.host)) {
    al.lock(function(ul){ serviceRequest(ul, TIMEOUT); });
  } else {
    serviceRequest(function(){}, 0);
  }
}).listen(8080);
