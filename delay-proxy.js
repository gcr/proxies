var http = require('http');

// This proxy imposes a 30-second delay on certain sites.
//
// engage with:
// sudo iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-ports 8080 -m owner '!' --uid-owner nobody
// sudo -u nobody node rotating-proxy.js

var al = new (require('./lib/async_lock.js').AsyncLock)(),
    TIMEOUT=1000 * 30,
    TIMED_DOMAINS = ['hackerne.ws', 'www.reddit.com', 'iamlights', 'bofh.ntk.net',
    'qdb.us', 'bash.org', 'meatandsarcasmguy', 'twitter.com'];

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
  function makeReq(cc) {
    // Make the outgoing connection
    var waiting = true, queue=[];
    function processRequest() {
      if (!waiting) {
        while (queue.length) {
          queue.shift()();
        }
      }
    }
    function serviceRequest(){
      if (waiting) {
        waiting = false;
        processRequest();
        cc();
      }
    }
    console.log("Got request for "+proxiedReq.headers.host+" : "+proxiedReq.url+"...");
    delete proxiedReq.headers.connection;
    var newClient = http.createClient(80, proxiedReq.headers.host),
        newReq = newClient.request(proxiedReq.method, proxiedReq.url, proxiedReq.headers);
    proxiedReq.connection.setMaxListeners(15);
    proxiedReq.connection.addListener('error', function(error) {
      console.log(error);
      console.log(error.stack);
    });
    proxiedReq.connection.addListener('end', function(error) {
      console.log("Canceling request");
      serviceRequest();
    });

    newClient.addListener('error', function(error) {
      console.log(error);
      console.log(error.stack);
    });

    newReq.addListener('response', function(newRes) {
      // when the server (the website the client is browsing to) gives us our
      // response
      console.log("Got response");

      newRes.addListener('error', function(error) {
        console.log(error);
        console.log(error.stack);
      });
      newRes.addListener('data', function(chunk) {
        queue.push(function(){
          proxiedRes.write(chunk, 'binary');
        });
        processRequest();
      });
      newRes.addListener('end', function() {
        queue.push(function(){
          proxiedRes.end();
        });
        //if (queue.length == 1) {
        //  // just in case it's a redirect or something
        //  serviceRequest();
        //}
        processRequest();
      });
      // pass headers on to the client
      proxiedRes.writeHead(newRes.statusCode, newRes.headers);
      proxiedRes.write('');
    });

    proxiedReq.addListener('data', function(chunk) {
      // when the client sends data, pass it through
      newReq.write(chunk, 'binary');
    });

    newReq.end();

    return serviceRequest;
  }

  if (shouldBeTimed(proxiedReq)) {
    al.lock(function(unlock){
      setTimeout(makeReq(unlock), TIMEOUT);
    });
  } else {
    setTimeout(makeReq(function(){}),0);
  }
}).listen(8080);
