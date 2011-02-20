var http = require('http');

// This proxy imposes a 30-second delay on certain sites.
//
// engage with:
// sudo iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-ports 8080 -m owner '!' --uid-owner nobody
// sudo -u nobody node rotating-proxy.js

var al = new (require('./lib/async_lock.js').AsyncLock)(),
    TIMEOUT=1000 * 30,
    TIMED_DOMAINS = ['hackerne.ws', 'reddit', 'iamlights', 'bofh.ntk.net'];

function shouldBeTimed(req) {
  if (req.url.indexOf("png") != -1 ||
      req.url.indexOf("css") != -1 ||
      req.url.indexOf("jpg") != -1 ||
      req.url.indexOf("ico") != -1 ||
      req.url.indexOf("gif") != -1) {
    return false;
  }
  for (var target=0,l=TIMED_DOMAINS.length; target<l; target++) {
    if (req.headers.host.toLowerCase().indexOf(TIMED_DOMAINS[target]) != -1) {
      return true;
    }
  }
  return false;
}


http.createServer(function(proxiedReq, proxiedRes) {
  // Make the outgoing connection
  console.log("Waiting...");
  function serviceRequest(cc, timeout) {
    // call cc when the page is loaded.
    // WARNING cc may be called multiple times.
    var cont = true;
    proxiedReq.connection.setMaxListeners(15);
    proxiedReq.connection.addListener('error', function(error) {
        console.log(error);
        console.log(error.stack);
        cont=false;
        cc();
      });
    proxiedReq.connection.addListener('end', function(error) {
        console.log("Canceling request");
        cont=false;
        cc();
      });
    setTimeout(function(){
      if(!cont) { return; }
      console.log("Serving request...");
      delete proxiedReq.headers.connection;
      var newClient = http.createClient(80, proxiedReq.headers.host),
          newReq = newClient.request(proxiedReq.method, proxiedReq.url, proxiedReq.headers);

      newClient.addListener('error', function(error) {
          console.log(error);
          console.log(error.stack);
          cc();
        });

      newReq.addListener('response', function(newRes) {
          // when the server (the website the client is browsing to) gives us our
          // response

          newRes.addListener('error', function(error) {
              console.log(error);
              console.log(error.stack);
              cc();
            });
          newRes.addListener('data', function(chunk) {
              proxiedRes.write(chunk, 'binary');
            });
          newRes.addListener('end', function() {
              proxiedRes.end();
              cc();
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
          cc();
        });

      newReq.end();
    }, timeout);
  }

  if (shouldBeTimed(proxiedReq)) {
    al.lock(function(unlockReal){
      console.log("Lock serviced us...");
      var locked=true;
      function unlock(){
        if (locked) {
          console.log("Unlocked");
          locked=false;
          unlockReal();
        }
      }
      serviceRequest(unlock, TIMEOUT);
    });
  } else {
    serviceRequest(function(){}, 0);
  }
}).listen(8080);
